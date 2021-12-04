import type {ProcessorUtils} from '@drovp/types';
import type {Payload} from './';
import * as OS from 'os';
import * as Path from 'path';
import * as CP from 'child_process';
import {promisify} from 'util';
import {promises as FSP} from 'fs';
import * as dayjs from 'dayjs';
import {platformPaths} from 'platform-paths';
import {expandTemplateLiteral} from 'expand-template-literal';
import * as prettyMs from 'pretty-ms';

const exec = promisify(CP.exec);

export default async function (payload: Payload, {stage, output}: ProcessorUtils) {
	const {id, input, options} = payload;
	const stdouts: string[] = [];
	const stderrs: string[] = [];
	const commonVariables: Record<string, any> = {
		// Data
		starttime: Date.now(),

		// Utilities
		Path,
		time: dayjs,
		uid,
	};
	const {commands, outputs, outputMode} = options;

	// Normalize inputs
	const inputs: Record<string, any>[] = [];

	for (const input of payload.inputs) {
		switch (input.kind) {
			case 'directory':
			case 'file': {
				inputs.push({
					type: input.kind,
					payload: input.path,
					...extractPathVariables(input.path),
				});
				break;
			}
			case 'string':
				inputs.push({
					type: input.kind,
					contents: input.contents,
					payload: input.contents,
				});
				break;
			case 'url': {
				const url = new URL(input.url);
				inputs.push({
					type: input.kind,
					url: input.url,
					hostname: url.hostname,
					pathname: url.pathname,
					username: url.username,
					password: url.password,
					payload: input.url,
				});
				break;
			}
		}
	}

	// Add them to variables
	if (options.bulk) {
		commonVariables.inputs = inputs;
	} else if (inputs.length > 0) {
		Object.assign(commonVariables, inputs[0]);
		commonVariables.type = input.kind;
	}

	// Find common directory
	let onlyFiles = inputs.filter((input) => input.type === 'file' || input.type === 'directory');
	let commondir = onlyFiles[0]?.dirname || 'undefined';
	for (let i = 1; i < onlyFiles.length; i++) commondir = commonPathsRoot(commondir, onlyFiles[i]!.path);
	commonVariables.commondir = commondir;

	// Query needed platform paths
	const allTemplates = [
		...commands.map(({template}) => template),
		...commands.map(({cwd}) => cwd),
		...outputs.map(({template}) => template),
	].join(';');
	for (const name of Object.keys(platformPaths) as (keyof typeof platformPaths)[]) {
		if (allTemplates.includes(name)) commonVariables[name] = await platformPaths[name]();
	}

	// Stdouts
	if (!options.parallelMode) {
		commonVariables.stdouts = stdouts;
		commonVariables.stderrs = stderrs;
	}

	// Create temporary directory
	const tmpDir = Path.join(OS.tmpdir(), `drovp-run-operation-${id}`);
	const tmpDirIsNeeded = commands.find(({cwd}) => cwd.trim().length === 0) != null;
	if (tmpDirIsNeeded) {
		console.log(`creating temporary working directory`);
		console.log(`path: "${tmpDir}"`);
		await FSP.mkdir(tmpDir, {recursive: true});
	}
	const cleanup = async () => {
		if (!tmpDirIsNeeded) return;
		console.log(`deleting temporary working directory`);
		await FSP.rm(tmpDir, {recursive: true});
	};

	// Execute commands
	const parallelPromises = [];

	for (let i = 0; i < commands.length; i++) {
		let {template, cwd, ignoreErrors} = commands[i]!;
		const variables: typeof commonVariables = {...commonVariables, cwd};

		if (options.parallelMode) {
			variables.stdout = stdouts[stdouts.length - 1];
			variables.stderr = stderrs[stderrs.length - 1];
		} else {
			stage(`${i + 1}/${options.commands.length}`);
		}

		// Expand cwd
		cwd = `${cwd}`.trim();
		let cwdPath: string;

		if (cwd.length > 0) {
			// Detokenize cwd
			try {
				cwdPath = await expandTemplateLiteral(cwd.replace(/\r?\n/g, '').trim(), commonVariables);
			} catch (error) {
				output.error(`command[${i}] cwd template error: ${eem(error)}`);
				return;
			}

			// Ensure it exists
			try {
				const stat = await pathExists(cwdPath);
				if (!stat || stat.isDirectory()) await FSP.mkdir(cwdPath, {recursive: true});
			} catch (error) {
				output.error(
					`command[${i}]: Error creating cwd "${cwd}"${
						cwd !== cwdPath ? `, expanded into "${cwdPath}":` : ''
					}: ${eem(error)}`
				);
				return;
			}
		} else {
			cwdPath = tmpDir;
		}

		variables.cwd = cwdPath;

		// Expand command template
		console.log(`===== COMMAND[${i}]: ==========\n${template}`);
		let command: string | undefined;
		try {
			command = await expandTemplateLiteral(template.replace(/\s*(\^|\\)?\n\s*/g, ' ').trim(), variables).trim();
		} catch (error) {
			console.log(`----- TEMPLATE ERROR: ------`);
			output.error(eem(error));
			console.log(`============================`);
			return;
		}

		console.log(
			`----- FILLED: --------------\n${command}\n----- CWD: -----------------\n"${cwdPath}"\n============================`
		);

		if (!command) {
			output.error(`command[${i}]: template produced an empty command`);
			return;
		}

		// Execute the command
		const commandStartTime = Date.now();
		const reportTime = () => console.log(`command[${i}] time: ${prettyMs(Date.now() - commandStartTime)}`);
		const resolve = ({stdout, stderr}: {stdout: string; stderr: string}) => {
			stdouts[i] = `${stdout}`;
			stderrs[i] = `${stderr}`;
		};
		const reject = (error: any) => {
			output.error(`COMMAND[${i}] failed with exit code ${error.code}.`);
		};

		try {
			const process = exec(command, {cwd: cwdPath});

			// Operation logs
			process.child.stdout?.on('data', (buffer) => console.log(buffer.toString()));
			process.child.stderr?.on('data', (buffer) => console.log(buffer.toString()));

			if (options.parallelMode) {
				parallelPromises.push(process.then(resolve).catch(reject).finally(reportTime));
			} else {
				const result = await process;
				reportTime();
				resolve(result);
			}
		} catch (error) {
			reject(error);
			if (!ignoreErrors) break;
		}
	}

	if (parallelPromises.length > 0) await Promise.all(parallelPromises);

	await cleanup();

	// Ensure stdouts are available for output templates
	commonVariables.stdouts = stdouts;

	/**
	 * Emit outputs.
	 */
	for (let i = 0; i < options.outputs.length; i++) {
		let {template, type} = outputs[i]!;

		let payload: string | undefined;
		try {
			payload = await expandTemplateLiteral(template.replace(/\s*(\^|\\)?\n\s*/g, ' ').trim(), commonVariables);
		} catch (error) {
			throw new Error(`output[${i}] template error: ${eem(error)}`);
		}

		if (payload) {
			output[type](payload || '');
			if (outputMode === 'first') break;
		} else {
			if (outputMode === 'all') output.error(`output[${i}] template produced an empty string.`);
		}
	}
}

/**
 * Utils.
 */

function eem(error: any, preferStack = false) {
	return error instanceof Error ? (preferStack ? error.stack || error.message : error.message) : `${error}`;
}

const uid = (size = 10) =>
	Array(size)
		.fill(0)
		.map(() => Math.floor(Math.random() * 36).toString(36))
		.join('');

async function pathExists(path: string) {
	try {
		return await FSP.stat(path);
	} catch (error) {
		if ((error as any)?.code === 'ENOENT') return false;
		throw error;
	}
}

function extractPathVariables(path: string) {
	const extname = Path.extname(path);
	const dirname = Path.dirname(path);
	return {
		path,
		extname,
		ext: extname.slice(1),
		dirname,
		basename: Path.basename(path),
		filename: Path.basename(path, extname),
		dirbasename: Path.basename(dirname),
	};
}

export function commonPathsRoot(a: string, b: string) {
	let sameParts: string[] = [];
	const aParts = a.split(/[\\\/]+/);
	const bParts = b.split(/[\\\/]+/);
	const loopSize = Math.min(aParts.length, bParts.length);

	for (let i = 0; i < loopSize; i++) {
		if (aParts[i] === bParts[i]) sameParts.push(aParts[i]!);
		else break;
	}

	return sameParts.join(Path.sep);
}
