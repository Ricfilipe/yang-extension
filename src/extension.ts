import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

let diagnosticCollection: vscode.DiagnosticCollection;
let pyangAvailable = false;

export function activate(context: vscode.ExtensionContext) {
	console.log('YANG Validator extension activated');

	// Create diagnostic collection
	diagnosticCollection = vscode.languages.createDiagnosticCollection('yang');
	context.subscriptions.push(diagnosticCollection);

	// Check if pyang is installed
	checkAndSetupPyang(context);

	// Watch for YANG file changes
	const watcher = vscode.workspace.createFileSystemWatcher('**/*.yang', false, false, false);
	context.subscriptions.push(watcher);

	// Validate on file creation
	watcher.onDidCreate((uri) => {
		validateYangFile(uri);
	});

	// Validate on file change
	watcher.onDidChange((uri) => {
		console.log(`File changed: ${uri.fsPath}`);
		validateYangFile(uri);
	});

	// Clear diagnostics on file deletion
	watcher.onDidDelete((uri) => {
		diagnosticCollection.delete(uri);
	});

	// Validate open editors
	if (vscode.window.activeTextEditor) {
		validateYangFile(vscode.window.activeTextEditor.document.uri);
	}


	let diagnosticTimeout: NodeJS.Timeout | undefined;
	vscode.workspace.onDidChangeTextDocument((event) => {
		if (event.document.languageId === 'yang') {
			// Clear the previous timer if user is still typing
			if (diagnosticTimeout) {
				clearTimeout(diagnosticTimeout);
			}

			// Wait 500ms after the user stops typing to validate
			diagnosticTimeout = setTimeout(() => {
				validateYangFile(event.document.uri);
			}, 500);
		}
	});

	// Validate on active editor change
	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor && editor.document.languageId === 'yang') {
			validateYangFile(editor.document.uri);
		}
	});

	// Register validate current file command
	const validateFileCommand = vscode.commands.registerCommand(
		'yang-validator.validateCurrentFile',
		() => {
			if (vscode.window.activeTextEditor) {
				validateYangFile(vscode.window.activeTextEditor.document.uri);
				vscode.window.showInformationMessage('YANG file validated');
			} else {
				vscode.window.showWarningMessage('No active editor');
			}
		}
	);
	context.subscriptions.push(validateFileCommand);

	// Register validate directory command
	const validateDirCommand = vscode.commands.registerCommand(
		'yang-validator.validateDirectory',
		async () => {
			const folders = vscode.workspace.workspaceFolders;
			if (!folders || folders.length === 0) {
				vscode.window.showWarningMessage('No workspace folder open');
				return;
			}

			const folder = await vscode.window.showWorkspaceFolderPick();
			if (!folder) {
				return;
			}

			vscode.window.showInformationMessage(`Validating YANG files in ${folder.name}...`);
			validateDirectory(folder.uri.fsPath);
		}
	);
	context.subscriptions.push(validateDirCommand);

	// Register install pyang command
	const installPyangCommand = vscode.commands.registerCommand(
		'yang-validator.installPyang',
		() => {
			const extension = vscode.extensions.getExtension('undefined_publisher.yang-validator');
			if (extension) {
				setupBundledPyang({ extensionPath: extension.extensionPath } as any);
			}
		}
	);
	context.subscriptions.push(installPyangCommand);

	// Register completion provider for YANG keywords
	const completionProvider = vscode.languages.registerCompletionItemProvider(
		'yang',
		getYangCompletionProvider(),
		''
	);
	context.subscriptions.push(completionProvider);

	// Validate all YANG files in workspace on activation
	if (pyangAvailable) {
		validateAllYangFiles();
	}
}

async function checkAndSetupPyang(context: vscode.ExtensionContext): Promise<void> {
	const extensionPath = context.extensionPath;
	const venvPath = path.join(extensionPath, '.venv');
	const pyangPath = process.platform === 'win32' 
		? path.join(venvPath, 'Scripts', 'pyang.exe')
		: path.join(venvPath, 'bin', 'pyang');
	
	try {
		execSync(`"${pyangPath}" --version`, { encoding: 'utf-8' });
		pyangAvailable = true;
		console.log('Bundled pyang is available');
	} catch (error) {
		pyangAvailable = false;
		console.error('Bundled pyang is not available');
		
		const response = await vscode.window.showWarningMessage(
			'The YANG Validator extension needs to set up its bundled Python environment with pyang.',
			'Setup Environment',
			'Learn more',
			'Dismiss'
		);

		if (response === 'Setup Environment') {
			setupBundledPyang(context);
		} else if (response === 'Learn more') {
			vscode.env.openExternal(vscode.Uri.parse('https://github.com/openconfig/pyang'));
		}
	}
}

async function setupBundledPyang(context: vscode.ExtensionContext): Promise<void> {
	const extensionPath = context.extensionPath;
	const terminal = vscode.window.createTerminal('YANG Environment Setup');
	terminal.show();
	
	// Create virtual environment and install pyang
	const setupCommand = process.platform === 'win32'
		? `cd "${extensionPath}"; python -m venv .venv; .\\.venv\\Scripts\\Activate.ps1; pip install pyang`
		: `cd "${extensionPath}" && python3 -m venv .venv && source .venv/bin/activate && pip install pyang`;
	
	terminal.sendText(setupCommand, true);
	
	const response = await vscode.window.showInformationMessage(
		'Python environment setup started. Click "Verify Setup" after completion.',
		'Verify Setup'
	);

	if (response === 'Verify Setup') {
		setTimeout(() => {
			checkBundledPyangSetup(context);
		}, 3000);
	}
}

async function checkBundledPyangSetup(context: vscode.ExtensionContext): Promise<void> {
	try {
		const extensionPath = context.extensionPath;
		const venvPath = path.join(extensionPath, '.venv');
		const pyangPath = process.platform === 'win32' 
			? path.join(venvPath, 'Scripts', 'pyang.exe')
			: path.join(venvPath, 'bin', 'pyang');
			
		execSync(`"${pyangPath}" --version`, { encoding: 'utf-8' });
		pyangAvailable = true;
		vscode.window.showInformationMessage('✓ YANG Validator environment setup complete! Validation is now active.');
		validateAllYangFiles();
	} catch (error) {
		vscode.window.showErrorMessage('Environment setup verification failed. Please check the terminal for errors.');
	}
}

function validateYangFile(uri: vscode.Uri): void {
	const filePath = uri.fsPath;

	if (!filePath.endsWith('.yang')) {
		return;
	}

	if (!pyangAvailable) {
		const diagnostic = new vscode.Diagnostic(
			new vscode.Range(0, 0, 0, 1),
			'pyang is not available. Run "YANG: Install pyang" command.',
			vscode.DiagnosticSeverity.Error
		);
		diagnosticCollection.set(uri, [diagnostic]);
		return;
	}

	try {
		const config = vscode.workspace.getConfiguration('yangValidator');
		const isEnabled = config.get<boolean>('enable', true);

		if (!isEnabled) {
			return;
		}

		// Use bundled pyang
		const extension = vscode.extensions.getExtension('undefined_publisher.yang-validator');
		if (!extension) {
			throw new Error('Extension not found');
		}
		
		const extensionPath = extension.extensionPath;
		const venvPath = path.join(extensionPath, '.venv');
		const pyangPath = process.platform === 'win32' 
			? path.join(venvPath, 'Scripts', 'pyang.exe')
			: path.join(venvPath, 'bin', 'pyang');

		// Run pyang validation
		try {
			let output = execSync(`"${pyangPath}" "${filePath}"`, { encoding: 'utf-8' });
			console.log(`Validated ${filePath}: ${output.trim()}`);
			// If no error, file is valid
			diagnosticCollection.set(uri, []);
		} catch (error: any) {
			// Parse pyang output for errors
			const output = error.stdout || error.stderr || error.message;
			const diagnostics = parsePyangOutput(output, uri);
			diagnosticCollection.set(uri, diagnostics);
		}
	} catch (error: any) {
		// pyang not found or other error
		const message = `Error validating YANG file: ${error.message}`;
		const diagnostic = new vscode.Diagnostic(
			new vscode.Range(0, 0, 0, 1),
			message,
			vscode.DiagnosticSeverity.Error
		);
		diagnosticCollection.set(uri, [diagnostic]);
	}
}

function validateDirectory(dirPath: string): void {
	if (!pyangAvailable) {
		vscode.window.showErrorMessage('pyang is not available. Run "YANG: Install pyang" command.');
		return;
	}

	const yangFiles = findYangFiles(dirPath);
	let validCount = 0;
	let errorCount = 0;

	yangFiles.forEach((filePath) => {
		const uri = vscode.Uri.file(filePath);
		try {
			const config = vscode.workspace.getConfiguration('yangValidator');
			const isEnabled = config.get<boolean>('enable', true);

			if (!isEnabled) {
				return;
			}

			// Use bundled pyang
			const extension = vscode.extensions.getExtension('undefined_publisher.yang-validator');
			if (!extension) {
				throw new Error('Extension not found');
			}
			
			const extensionPath = extension.extensionPath;
			const venvPath = path.join(extensionPath, '.venv');
			const pyangPath = process.platform === 'win32' 
				? path.join(venvPath, 'Scripts', 'pyang.exe')
				: path.join(venvPath, 'bin', 'pyang');

			try {
				let output = execSync(`"${pyangPath}" "${filePath}"`, { encoding: 'utf-8' });
				console.log(`Validated ${filePath}: ${output.trim()}`);
				validCount++;
				diagnosticCollection.set(uri, []);
			} catch (error: any) {
				errorCount++;
				const output = error.stdout || error.stderr || error.message;
				const diagnostics = parsePyangOutput(output, uri);
				diagnosticCollection.set(uri, diagnostics);
			}
		} catch (error) {
			errorCount++;
		}
	});

	const message = `Validation complete: ${validCount} valid, ${errorCount} with errors`;
	vscode.window.showInformationMessage(message);
}

function validateAllYangFiles(): void {
	if (!vscode.workspace.workspaceFolders) {
		return;
	}

	vscode.workspace.workspaceFolders.forEach((folder) => {
		validateDirectory(folder.uri.fsPath);
	});
}

function findYangFiles(dirPath: string): string[] {
	const yangFiles: string[] = [];

	try {
		const entries = fs.readdirSync(dirPath, { withFileTypes: true });

		entries.forEach((entry) => {
			const fullPath = path.join(dirPath, entry.name);

			if (entry.isDirectory()) {
				// Skip node_modules and .git
				if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
					yangFiles.push(...findYangFiles(fullPath));
				}
			} else if (entry.isFile() && entry.name.endsWith('.yang')) {
				yangFiles.push(fullPath);
			}
		});
	} catch (error) {
		console.error(`Error reading directory ${dirPath}:`, error);
	}

	return yangFiles;
}

function parsePyangOutput(output: string, uri: vscode.Uri): vscode.Diagnostic[] {
	const diagnostics: vscode.Diagnostic[] = [];
	const lines = output.split('\n');
	const fileText = fs.existsSync(uri.fsPath) ? fs.readFileSync(uri.fsPath, 'utf-8') : '';
	const sourceLines = fileText.split(/\r?\n/);

	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}

		const cleanLine = line.trim().replace(/\r/g, "");

		// Parse pyang output format: filename:line:column: error type: message
		const match = cleanLine.match(/^(?:[a-zA-Z]:)?[^:]+:(\d+):(?:(\d+):)?\s*(\w+):\s*(.*)$/);
		if (match) {
			const lineNum = parseInt(match[1], 10) - 1;
			const startCol = match[2] ? parseInt(match[2], 10) - 1 : 0;
			const severity = match[3].toLowerCase();
			const message = match[4];
			let diagSeverity = vscode.DiagnosticSeverity.Error;
			if (severity.includes('warning')) {
				diagSeverity = vscode.DiagnosticSeverity.Warning;
			} else if (severity.includes('error')) {
				diagSeverity = vscode.DiagnosticSeverity.Error;
			}

			// Find the actual start of statement by looking backwards
			let startLineNum = lineNum;
			let startActualCol = startCol;
			
			// Skip leading whitespace on error line
			const errorLineText = sourceLines[lineNum] || '';
			while (startActualCol < errorLineText.length && /[ \t]/.test(errorLineText[startActualCol])) {
				startActualCol += 1;
			}

			// Look backwards to find where this statement begins
			let foundStart = false;
			for (let ln = lineNum - 1; ln >= 0 && !foundStart; ln--) {
				const text = sourceLines[ln];
				let inSingleQuote = false;
				let inDoubleQuote = false;
				let escaped = false;

				for (let i = text.length - 1; i >= 0; i--) {
					const ch = text[i];
					if (escaped) {
						escaped = false;
						continue;
					}

					if (ch === '\\') {
						escaped = true;
						continue;
					}

					if (!inSingleQuote && ch === '"') {
						inDoubleQuote = !inDoubleQuote;
						continue;
					}

					if (!inDoubleQuote && ch === "'") {
						inSingleQuote = !inSingleQuote;
						continue;
					}

					// Found previous statement terminator
					if (!inSingleQuote && !inDoubleQuote && (ch === ';' || ch === '}')) {
						startLineNum = ln + 1;
						foundStart = true;
						break;
					}
				}
			}

			// If we found a previous terminator, use the line after it.
			// Skip blank lines and leading whitespace before the actual statement.
			let searchStartLine = startLineNum;
			let searchStartCol = 0;

			// Advance to first non-empty line when the start line is blank.
			while (
				searchStartLine < sourceLines.length &&
				sourceLines[searchStartLine].trim().length === 0 &&
				searchStartLine < lineNum
			) {
				searchStartLine += 1;
			}

			const startLineText = sourceLines[searchStartLine] || '';
			if (searchStartLine === lineNum) {
				searchStartCol = startActualCol;
			} else {
				for (let i = 0; i < startLineText.length; i++) {
					if (!/[ \t]/.test(startLineText[i])) {
						searchStartCol = i;
						break;
					}
				}
			}
			// Now search forward from start to find the ending delimiter
			let endLineNum = lineNum;
			let endCol = startActualCol + 1;
			let inSingleQuote = false;
			let inDoubleQuote = false;
			let escaped = false;
			let found = false;

			// Search from start position onwards, including next lines
			for (let ln = searchStartLine; ln < sourceLines.length && !found; ln++) {
				const text = sourceLines[ln];
				const startIdx = ln === searchStartLine ? searchStartCol : 0;

				for (let i = startIdx; i < text.length; i++) {
					const ch = text[i];
					if (escaped) {
						escaped = false;
						continue;
					}

					if (ch === '\\') {
						escaped = true;
						continue;
					}

					if (!inSingleQuote && ch === '"') {
						inDoubleQuote = !inDoubleQuote;
						continue;
					}

					if (!inDoubleQuote && ch === "'") {
						inSingleQuote = !inSingleQuote;
						continue;
					}

					if (!inSingleQuote && !inDoubleQuote && (ch === ';' || ch === '{')) {
						// End is on the same line as the delimiter, but before it
						endLineNum = ln;
						let endPos = i;
						// Trim trailing whitespace before the delimiter
						while (endPos > searchStartCol && /[ \t]/.test(text[endPos - 1])) {
							endPos -= 1;
						}
						endCol = Math.max(endPos, searchStartCol + 1);
						found = true;
						break;
					}
				}
			}

			const range = new vscode.Range(
				searchStartLine,
				Math.max(0, searchStartCol),
				endLineNum,
				Math.max(endCol, searchStartCol + 1)
			);

			const diagnostic = new vscode.Diagnostic(range, message, diagSeverity);
			diagnostic.code = severity;
			diagnostic.source = 'pyang';
			diagnostics.push(diagnostic);
		}
	}

	return diagnostics;
}

function getYangCompletionProvider(): vscode.CompletionItemProvider {
	const yangKeywords = [
		// Module structure
		{ label: 'module', kind: vscode.CompletionItemKind.Keyword, detail: 'Defines a YANG module' },
		{ label: 'submodule', kind: vscode.CompletionItemKind.Keyword, detail: 'Defines a submodule belonging to a module' },
		{ label: 'namespace', kind: vscode.CompletionItemKind.Keyword, detail: 'URI for the module' },
		{ label: 'prefix', kind: vscode.CompletionItemKind.Keyword, detail: 'Prefix for the module namespace' },
		{ label: 'yang-version', kind: vscode.CompletionItemKind.Keyword, detail: 'YANG version (1.0 or 1.1)' },
		{ label: 'organization', kind: vscode.CompletionItemKind.Keyword, detail: 'Organization name' },
		{ label: 'contact', kind: vscode.CompletionItemKind.Keyword, detail: 'Contact information' },
		{ label: 'description', kind: vscode.CompletionItemKind.Keyword, detail: 'Textual description' },
		{ label: 'reference', kind: vscode.CompletionItemKind.Keyword, detail: 'Reference information' },
		
		// Imports and includes
		{ label: 'import', kind: vscode.CompletionItemKind.Keyword, detail: 'Import another module' },
		{ label: 'include', kind: vscode.CompletionItemKind.Keyword, detail: 'Include a submodule' },
		{ label: 'revision', kind: vscode.CompletionItemKind.Keyword, detail: 'Revision statement' },
		{ label: 'revision-date', kind: vscode.CompletionItemKind.Keyword, detail: 'Date of revision' },
		
		// Type definitions
		{ label: 'typedef', kind: vscode.CompletionItemKind.Keyword, detail: 'Defines a user-defined type' },
		{ label: 'type', kind: vscode.CompletionItemKind.Keyword, detail: 'Built-in or derived type' },
		{ label: 'container', kind: vscode.CompletionItemKind.Keyword, detail: 'Container node' },
		{ label: 'leaf', kind: vscode.CompletionItemKind.Keyword, detail: 'Leaf node (single value)' },
		{ label: 'leaf-list', kind: vscode.CompletionItemKind.Keyword, detail: 'Leaf-list node (multiple values)' },
		{ label: 'list', kind: vscode.CompletionItemKind.Keyword, detail: 'List node' },
		{ label: 'choice', kind: vscode.CompletionItemKind.Keyword, detail: 'Choice between alternatives' },
		{ label: 'case', kind: vscode.CompletionItemKind.Keyword, detail: 'Case in a choice' },
		
		// Grouping and augment
		{ label: 'grouping', kind: vscode.CompletionItemKind.Keyword, detail: 'Defines a reusable group of nodes' },
		{ label: 'uses', kind: vscode.CompletionItemKind.Keyword, detail: 'References a grouping' },
		{ label: 'augment', kind: vscode.CompletionItemKind.Keyword, detail: 'Augments nodes in another module' },
		{ label: 'refine', kind: vscode.CompletionItemKind.Keyword, detail: 'Refines nodes from a grouping' },
		
		// RPC and notifications
		{ label: 'rpc', kind: vscode.CompletionItemKind.Keyword, detail: 'RPC definition' },
		{ label: 'input', kind: vscode.CompletionItemKind.Keyword, detail: 'Input parameters for RPC' },
		{ label: 'output', kind: vscode.CompletionItemKind.Keyword, detail: 'Output of RPC' },
		{ label: 'notification', kind: vscode.CompletionItemKind.Keyword, detail: 'Notification message' },
		
		// Constraints and validation
		{ label: 'must', kind: vscode.CompletionItemKind.Keyword, detail: 'Mandatory constraint' },
		{ label: 'when', kind: vscode.CompletionItemKind.Keyword, detail: 'Conditional constraint' },
		{ label: 'config', kind: vscode.CompletionItemKind.Keyword, detail: 'true or false (configuration data)' },
		{ label: 'status', kind: vscode.CompletionItemKind.Keyword, detail: 'current, deprecated, or obsolete' },
		{ label: 'mandatory', kind: vscode.CompletionItemKind.Keyword, detail: 'true or false' },
		{ label: 'min-elements', kind: vscode.CompletionItemKind.Keyword, detail: 'Minimum number of elements' },
		{ label: 'max-elements', kind: vscode.CompletionItemKind.Keyword, detail: 'Maximum number of elements' },
		{ label: 'ordered-by', kind: vscode.CompletionItemKind.Keyword, detail: 'user or system' },
		{ label: 'presence', kind: vscode.CompletionItemKind.Keyword, detail: 'Presence container' },
		
		// Type constraints
		{ label: 'length', kind: vscode.CompletionItemKind.Keyword, detail: 'String length constraint' },
		{ label: 'pattern', kind: vscode.CompletionItemKind.Keyword, detail: 'Regular expression pattern' },
		{ label: 'range', kind: vscode.CompletionItemKind.Keyword, detail: 'Numeric range constraint' },
		{ label: 'fraction-digits', kind: vscode.CompletionItemKind.Keyword, detail: 'Decimal fraction digits' },
		{ label: 'base', kind: vscode.CompletionItemKind.Keyword, detail: 'Base type for enumeration' },
		{ label: 'enum', kind: vscode.CompletionItemKind.Keyword, detail: 'Enumeration value' },
		{ label: 'bit', kind: vscode.CompletionItemKind.Keyword, detail: 'Bit in a bits type' },
		
		// Other
		{ label: 'default', kind: vscode.CompletionItemKind.Keyword, detail: 'Default value' },
		{ label: 'units', kind: vscode.CompletionItemKind.Keyword, detail: 'Unit of measurement' },
		{ label: 'require-instance', kind: vscode.CompletionItemKind.Keyword, detail: 'true or false' },
		{ label: 'key', kind: vscode.CompletionItemKind.Keyword, detail: 'Key nodes for a list' },
		{ label: 'unique', kind: vscode.CompletionItemKind.Keyword, detail: 'Unique constraint' },
		{ label: 'error-message', kind: vscode.CompletionItemKind.Keyword, detail: 'Error message' },
		{ label: 'error-app-tag', kind: vscode.CompletionItemKind.Keyword, detail: 'Application-specific error tag' },
		{ label: 'position', kind: vscode.CompletionItemKind.Keyword, detail: 'Position in bits' },
		{ label: 'value', kind: vscode.CompletionItemKind.Keyword, detail: 'Enum or bit value' },
		{ label: 'modifier', kind: vscode.CompletionItemKind.Keyword, detail: 'Pattern modifier (invert-match)' },
		{ label: 'argument', kind: vscode.CompletionItemKind.Keyword, detail: 'Extension argument' },
		{ label: 'yin-element', kind: vscode.CompletionItemKind.Keyword, detail: 'YIN/YANG format for extension' },
		
		// Built-in types
		{ label: 'string', kind: vscode.CompletionItemKind.TypeParameter, detail: 'Text string' },
		{ label: 'int8', kind: vscode.CompletionItemKind.TypeParameter, detail: '8-bit signed integer' },
		{ label: 'int16', kind: vscode.CompletionItemKind.TypeParameter, detail: '16-bit signed integer' },
		{ label: 'int32', kind: vscode.CompletionItemKind.TypeParameter, detail: '32-bit signed integer' },
		{ label: 'int64', kind: vscode.CompletionItemKind.TypeParameter, detail: '64-bit signed integer' },
		{ label: 'uint8', kind: vscode.CompletionItemKind.TypeParameter, detail: '8-bit unsigned integer' },
		{ label: 'uint16', kind: vscode.CompletionItemKind.TypeParameter, detail: '16-bit unsigned integer' },
		{ label: 'uint32', kind: vscode.CompletionItemKind.TypeParameter, detail: '32-bit unsigned integer' },
		{ label: 'uint64', kind: vscode.CompletionItemKind.TypeParameter, detail: '64-bit unsigned integer' },
		{ label: 'boolean', kind: vscode.CompletionItemKind.TypeParameter, detail: 'true or false' },
		{ label: 'empty', kind: vscode.CompletionItemKind.TypeParameter, detail: 'No value' },
		{ label: 'enumeration', kind: vscode.CompletionItemKind.TypeParameter, detail: 'Enumerated type' },
		{ label: 'bits', kind: vscode.CompletionItemKind.TypeParameter, detail: 'Bit flags' },
		{ label: 'binary', kind: vscode.CompletionItemKind.TypeParameter, detail: 'Binary data' },
		{ label: 'decimal64', kind: vscode.CompletionItemKind.TypeParameter, detail: 'Decimal number' },
		{ label: 'identityref', kind: vscode.CompletionItemKind.TypeParameter, detail: 'Reference to identity' },
		{ label: 'instance-identifier', kind: vscode.CompletionItemKind.TypeParameter, detail: 'Instance identifier' },
		{ label: 'union', kind: vscode.CompletionItemKind.TypeParameter, detail: 'Union of types' },
		
		// Boolean values
		{ label: 'true', kind: vscode.CompletionItemKind.Constant, detail: 'Boolean true' },
		{ label: 'false', kind: vscode.CompletionItemKind.Constant, detail: 'Boolean false' },
	];

	return {
		provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
			const linePrefix = document.lineAt(position.line).text.substr(0, position.character);
			
			// Don't suggest in comments or strings
			if (linePrefix.includes('//') || linePrefix.includes('/*') || linePrefix.includes('"') || linePrefix.includes("'")) {
				return [];
			}

			return yangKeywords.map(keyword => {
				const item = new vscode.CompletionItem(keyword.label, keyword.kind);
				item.detail = keyword.detail;
				item.insertText = keyword.label;
				return item;
			});
		}
	};
}

export function deactivate() {
	if (diagnosticCollection) {
		diagnosticCollection.dispose();
	}
}
