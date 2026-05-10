# YANG Validator

A VS Code extension that provides real-time validation of YANG (RFC 7950) files using `pyang`. Displays validation errors and warnings in the Problems panel.

## Features

- **Real-time validation**: Validates YANG files automatically as you edit
- **Structural validation**: Checks YANG model structure conformance
- **Error reporting**: Displays all validation errors and warnings in VS Code's Problems panel
- **Directory validation**: Command to validate all YANG files in a directory
- **File validation**: Command to manually validate the current YANG file
- **Language support**: Syntax highlighting and language configuration for YANG files

## Requirements

This extension includes its own Python environment with pyang bundled. No external installation is required!

The extension will automatically set up the Python environment on first use.

## Extension Settings

This extension contributes the following settings:

* `yangValidator.enable`: Enable/disable real-time YANG file validation (default: `true`)

Example `.vscode/settings.json`:
```json
{
  "yangValidator.enable": true
}
```

## Commands

- **YANG: Validate Current File** (`yang-validator.validateCurrentFile`): Validate the currently active YANG file
- **YANG: Validate Directory** (`yang-validator.validateDirectory`): Validate all YANG files in a selected directory

## Known Issues

- First-time setup requires Python to be installed on the system
- The bundled Python environment may take a moment to set up on first use

## Release Notes

### 0.0.1

Initial release of YANG Validator
- Real-time YANG file validation
- Directory validation support
- Problems panel integration

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
