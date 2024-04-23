# @pup/common

**Purpose:**

This package provides essential utility modules and types that are used across
multiple Pup components, including core, telemetry and api.

**Submodules**

- **`/ipc`:** Provides types and mechanisms for inter-process communication
  (IPC) within the Pup ecosystem. This is especially important for communication
  between Pup and managed processes.
- **`/path`:** Offers cross-platform path manipulation utilities, ensuring
  consistent path handling across different operating systems.
- **`/eventemitter`:** Includes an event emitter implementation, facilitating
  event-driven communication between Pup components.

**Usage**

1. **Install:**

   ```bash
   npm install @pup/common
   ```
   or
   ```bash
   yarn add @pup/common
   ```

2. **Import and Use:**

   ```typescript
   import { normalizePath } from "@pup/common/path";
   import { EventEmitter } from "@pup/common/eventemitter";

   const eventBus = new EventEmitter();
   eventBus.close(); // Allow the application to exit

   // Checks if absolute, else resolves using the supplied working directory
   const myAbsoutePath = toResolvedAbsolutePath(
     "/some/windows/style/path",
     "/working/directory",
   );
   ```

**Development and Contributions**

The `@pup/common` package is actively maintained by the Pup development team. If
you have suggestions for new utility modules, improvements, or bug fixes, please
open an issue on the GitHub repository: <https://github.com/hexagon/pup-common>.
Contributions are welcome!

This library follows semantic versioning. For a detailed history of changes,
please refer to the [CHANGELOG.md](./CHANGELOG.md).

**License**

This package is released under the MIT License. See [LICENSE](./LICENSE) for
details.
