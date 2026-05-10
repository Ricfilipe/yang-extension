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

	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}

		const cleanLine = line.trim().replace(/\r/g, "");

		// Parse pyang output format: filename:line:column: error type: message
		const match = cleanLine.match(/^(?:[a-zA-Z]:)?[^:]+:(\d+):(?:(\d+):)?\s*(\w+):\s*(.*)$/);
		if (match) {
			const lineNum = parseInt(match[1], 10) - 1;
			// Column might be undefined, default to 0
			const colNum = match[2] ? parseInt(match[2], 10) - 1 : 0;
			const severity = match[3].toLowerCase();
			const message = match[4];
			let diagSeverity = vscode.DiagnosticSeverity.Error;
			if (severity.includes('warning')) {
				diagSeverity = vscode.DiagnosticSeverity.Warning;
			} else if (severity.includes('error')) {
				diagSeverity = vscode.DiagnosticSeverity.Error;
			}

			const range = new vscode.Range(
				lineNum,
				Math.max(0, colNum),
				lineNum,
				Math.max(colNum + 1, 1)
			);

			const diagnostic = new vscode.Diagnostic(range, message, diagSeverity);
			diagnostic.code = severity;
			diagnostic.source = 'pyang';
			diagnostics.push(diagnostic);

			console.log(`Parsed diagnostic: ${message} at ${lineNum + 1}:${colNum + 1} (${severity})`);
		}
	}

	return diagnostics;
}

export function deactivate() {
	if (diagnosticCollection) {
		diagnosticCollection.dispose();
	}
}
