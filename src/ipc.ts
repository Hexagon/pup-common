/**
 * Compact file-based IPC mechanism for Deno.
 *
 * Manages file permissions and ensures that the messages were sent within a reasonable amount of time.
 *
 * The class is used due to Deno's current lack of support for secure cross-platform sockets.
 *
 * @file src/ipc.ts
 * @license MIT
 */

import {
  exists,
  type FSWatcher,
  mkdir,
  readFile,
  unlink,
  watch,
  writeFile,
} from "@cross/fs";
import { basename, dirname, join } from "@std/path";
import { debounce } from "@std/async";
import { toResolvedAbsolutePath } from "./path.ts";
import { pid } from "@cross/utils/pid";
import { CurrentRuntime, Runtime } from "@cross/runtime";

export interface IpcValidatedMessage {
  pid: number | null;
  sent: Date | null;
  data: string | null;
  errors: string[];
}

export class FileIPC {
  public MAX_DATA_LENGTH = 1024;
  private filePath: string;
  private dirPath: string;
  private fileName: string;
  private staleMessageLimitMs: number;
  private debounceTimeMs: number;
  private messageQueue: IpcValidatedMessage[][] = [];
  private aborted = false;
  // @ts-ignore cross-runtime
  private watcher?: FSWatcher | Deno.Watcher;

  constructor(
    filePath: string,
    staleMessageLimitMs?: number,
    debounceTimeMs?: number,
  ) {
    this.filePath = toResolvedAbsolutePath(filePath);
    this.dirPath = toResolvedAbsolutePath(dirname(filePath)); // Get directory of the file
    this.fileName = basename(filePath); // Get name of the file
    this.staleMessageLimitMs = staleMessageLimitMs ?? 30000;
    this.debounceTimeMs = debounceTimeMs ?? 100;
  }

  public getFilePath(): string {
    return this.filePath;
  }

  /**
   * startWatching method initiates a file watcher on the filePath.
   * When a file modification event occurs, it will debounce the call to extractMessages to ensure it doesn't
   * get called more than once in a short amount of time (as specified by debounceTimeMs). The received messages
   * from the extractMessages call are then added to the messageQueue to be consumed by the receiveData generator.
   */
  private async startWatching() {
    // Stop if aborted
    if (this.aborted) return;

    // Create directory if it doesn't exist
    await mkdir(this.dirPath, { recursive: true });

    // Make an initial call to extractMessages to ensure that any existing messages are consumed
    const messages = await this.extractMessages();
    if (messages.length > 0) {
      this.messageQueue.push(messages);
    }

    // Watch the directory, not the file
    // @ts-ignore cross-runtime
    if (CurrentRuntime === Runtime.Deno) {
      this.watcher = Deno.watchFs(this.dirPath);
    } else {
      this.watcher = watch(this.dirPath);
    }
    // @ts-ignore cross-runtime
    for await (const event of this.watcher) {
      // Stop if aborted
      if (this.aborted) break;

      // Check that the event pertains to the correct file
      if (
        event.kind === "modify" &&
        event.paths.includes(join(this.dirPath, this.fileName))
      ) {
        debounce(async () => {
          try {
            const messages = await this.extractMessages();
            if (messages.length > 0) {
              this.messageQueue.push(messages);
            }
          } catch (_e) { /* Ignore errors */ }
        }, this.debounceTimeMs)();
      }
    }
  }

  /**
   * extractMessages is a private helper function that reads from the IPC file, validates the messages
   * and returns them as an array of IpcValidatedMessage. It also handles the removal of the file after
   * reading and validates the data based on the staleMessageLimitMs.
   *
   * This function is called every time a 'modify' event is detected by the file watcher started in startWatching method.
   *
   * Note: This function should only be used internally by the FileIPC class and is not meant to be exposed to external consumers.
   */
  private async extractMessages(): Promise<IpcValidatedMessage[]> {
    if (await exists(this.filePath)) {
      let fileContent;
      try {
        fileContent = await readFile(this.filePath);
      } catch (_e) {
        throw new Error(`Could not read '${this.filePath}'`);
      }

      try {
        await unlink(this.filePath);
      } catch (_e) {
        throw new Error(
          `Failed to remove '${this.filePath}', aborting ipc read.`,
        );
      }

      const receivedMessages: IpcValidatedMessage[] = [];

      try {
        let messages;
        if (fileContent) {
          messages = JSON.parse(new TextDecoder().decode(fileContent));
        } else {
          messages = { data: [] };
        }
        for (const messageObj of messages.data) {
          let validatedPid: number | null = null;
          let validatedSent: Date | null = null;
          let validatedData: string | null = null;
          const errors: string[] = [];

          // Validate pid
          try {
            validatedPid = parseInt(messageObj.pid);
          } catch (_e) {
            errors.push("Invalid data received: pid");
          }

          // Validate sent
          try {
            validatedSent = new Date(Date.parse(messageObj.sent));
          } catch (_e) {
            errors.push("Invalid data received: sent");
          }

          // Validate data
          if (
            validatedSent !== null &&
            validatedSent.getTime() >= Date.now() - this.staleMessageLimitMs
          ) {
            if (!messageObj.data) {
              errors.push("Invalid data received: missing");
            } else if (typeof messageObj.data !== "string") {
              errors.push("Invalid data received: not string");
            } else if (messageObj.data.length >= this.MAX_DATA_LENGTH) {
              errors.push("Invalid data received: too long");
            } else {
              validatedData = messageObj.data;
            }
          } else {
            errors.push("Invalid data received: stale");
          }

          receivedMessages.push({
            pid: validatedPid,
            sent: validatedSent,
            data: validatedData,
            errors,
          });
        }
        return receivedMessages;
      } catch (_e) {
        throw new Error(`Invalid content in ${this.filePath}.ipc`);
      }
    } else {
      return [];
    }
  }

  /**
   * Send data using the file-based IPC.
   *
   * Will append to file in `this.filePath` if it exists, otherwise create a new one
   *
   * @param data - Data to be sent.
   */
  async sendData(data: string): Promise<void> {
    // Create directory if it doesn't exist
    await mkdir(this.dirPath, { recursive: true });

    try {
      let fileContent;
      try {
        fileContent = await readFile(this.filePath);
      } catch (_e) { /* Ignore */ }
      let messages;
      if (fileContent) {
        messages = JSON.parse(new TextDecoder().decode(fileContent));
      } else {
        messages = { data: [] };
      }
      messages.data.push({
        pid: pid(),
        data,
        sent: new Date().toISOString(),
      });
      await writeFile(
        this.filePath,
        JSON.stringify(messages),
      );
    } catch (_e) {
      console.error("Error sending data, read or write failed.", _e);
    }
  }

  async *receiveData(): AsyncGenerator<IpcValidatedMessage[], void, unknown> {
    if (!this.watcher) this.startWatching();

    while (!this.aborted) {
      if (this.messageQueue.length > 0) {
        const messages = this.messageQueue.shift();
        if (messages) {
          yield messages;
        }
      } else {
        await new Promise((resolve) =>
          setTimeout(resolve, this.debounceTimeMs)
        );
      }
    }
  }

  /**
   * Close the file-based IPC and remove the IPC file.
   */
  async close(leaveFile?: boolean): Promise<void> {
    // Flag as aborted
    this.aborted = true;

    // Stop watching
    if (this.watcher) {
      if (CurrentRuntime === Runtime.Deno) {
        this.watcher.close();
      }
    }

    // Try to remove file, ignore failure
    if (!leaveFile) {
      try {
        await unlink(this.filePath);
      } catch (_e) {
        // Ignore
      }
    }
  }
}
