import type {ProcessorUtils} from '@drovp/types';
import type {Payload} from './';
import OS from 'os';
import Path from 'path';
import CP from 'child_process';
import {promisify} from 'util';
import {promises as FSP} from 'fs';

const exec = promisify(CP.exec);

const STATIC_TOKENS = [
	'path',
	'url',
	'string',
	'payload',
	'extname',
	'ext',
	'basename',
	'filename',
	'dirname',
	'dirbasename',
];

interface Command {
	command: string;
	filledCommand: string;
	cwd: string;
	ignoreErrors: boolean;
}

interface ResultTemplate {
	type: 'file' | 'directory' | 'url' | 'string';
	template: string;
	filledTemplate: string;
}

export default async ({id, item, options}: Payload, {stage, result}: ProcessorUtils) => {
	const tokenValues: Record<string, string> = {};
	const commands: Command[] = [];
	const stdouts: string[] = [];
	const resultTemplates: ResultTemplate[] = [];

	switch (item.kind) {
		case 'directory':
		case 'file': {
			const extname = Path.extname(item.path);
			const dirname = Path.dirname(item.path);
			Object.assign(tokenValues, {
				path: item.path,
				payload: item.path,
				extname,
				ext: extname.slice(1),
				dirname,
				basename: Path.basename(item.path),
				filename: Path.basename(item.path, extname),
				dirbasename: Path.basename(dirname),
			});
			break;
		}
		case 'string':
			Object.assign(tokenValues, {
				string: item.contents,
				payload: item.contents,
			});
			break;
		case 'url':
			Object.assign(tokenValues, {
				url: item.url,
				payload: item.url,
			});
			break;
	}

	function replaceStaticToken(tokenName: string, target: string) {
		const tokenValue = tokenValues[tokenName];
		return target.replaceAll(`{${tokenName}}`, tokenValue || '');
	}

	// Normalize/validate commands, and replace static tokens
	for (let i = 0; i < options.commands.length; i++) {
		let {command, cwd, ignoreErrors} = options.commands[i]!;
		command = command ? `${command}`.trim() : command;

		if (!command) throw new Error(`Command ${i} is empty.`);

		// Remove white space formatting
		let filledCommand = command.replaceAll(/\s*\n\s*/g, ' ').trim();

		for (const tokenName of STATIC_TOKENS) {
			const token = `{${tokenName}}`;

			if (tokenValues[tokenName] == null && filledCommand.includes(token)) {
				result.error(
					`Invalid command.\n\nEnabled input type "${item.kind}" doesn't have a ${tokenName}, yet ${token} token is used in command[${i}].`
				);
				return;
			}

			filledCommand = replaceStaticToken(tokenName, filledCommand);
			cwd = replaceStaticToken(tokenName, cwd);
		}

		commands.push({command, filledCommand, cwd, ignoreErrors});
	}

	// Normalize/validate resultTemplates, and replace static tokens
	for (let i = 0; i < options.resultTemplates.length; i++) {
		let {type, template} = options.resultTemplates[i]!;
		let filledTemplate = template;

		for (const tokenName of STATIC_TOKENS) {
			const token = `{${tokenName}}`;

			if (tokenValues[tokenName] == null && filledTemplate.includes(token)) {
				result.error(
					`Invalid result template.\n\nEnabled input type "${item.kind}" doesn't have a ${tokenName}, yet ${token} token is used in result[${i}].`
				);
				return;
			}

			filledTemplate = replaceStaticToken(tokenName, filledTemplate);
		}

		resultTemplates.push({type, template, filledTemplate});
	}

	// Create temporary directory
	const tmpDir = Path.join(OS.tmpdir(), `osum-run-operation-${id}`);
	console.log(`creating temporary working directory`);
	console.log(`path: "${tmpDir}"`);
	await FSP.mkdir(tmpDir, {recursive: true});
	const cleanup = async () => {
		console.log(`deleting temporary working directory`);
		await FSP.rm(tmpDir, {recursive: true});
	};

	// Execute commands
	const parallelPromises = [];

	for (let i = 0; i < commands.length; i++) {
		let {command, filledCommand, cwd, ignoreErrors} = commands[i]!;

		if (!options.parallelMode) stage(`${i + 1}/${commands.length}`);

		if (filledCommand.includes(`{stdout}`) && i == 0) {
			result.error(`{stdout} token used in 1st command, where there can't be any stdout yet.`);
			return;
		}

		if (options.parallelMode) {
			// {stdout[:N][:RegExp]}
			const regExp = /(?<!\\)\{stdout(:(?<tokenIndex>\d+))?(:(?<tokenRegExp>.+?))?(?<!\\)\}/g;
			let match;
			const matchTarget = filledCommand;
			while ((match = regExp.exec(matchTarget))) {
				const token = match[0]!;
				const {tokenIndex, tokenRegExp} = match.groups!;
				const stdout =
					tokenIndex != null ? stdouts[tokenIndex as unknown as number] : stdouts[stdouts.length - 1];

				if (stdout == null) {
					result.error(
						`Token "${token}" used in command[${i}], but stdout for command[${tokenIndex}] is not available.`
					);
					return;
				}

				if (tokenRegExp) {
					const match = new RegExp(tokenRegExp.replaceAll('\\{', '{').replaceAll('\\}', '}'), 'is').exec(
						stdout
					);
					if (match) {
						const result = match.groups?.result ?? match[0]!;
						filledCommand = filledCommand.replace(token, result);
					} else {
						result.error(
							`command[${i}] token "${token}" didn't match anything in command[${tokenIndex}] stdout.`
						);
						return;
					}
				} else {
					filledCommand = filledCommand.replace(token, stdout);
				}
			}

			// Remove escapes
			filledCommand = filledCommand.replaceAll('\\{', '{').replaceAll('\\}', '}');
		}

		// Execute the command
		console.log(`===== COMMAND[${i}]: ==========\ntemplate: ${command}\nfilled: ${filledCommand}`);
		const timeId = `command[${i}] time`;
		console.time(timeId);

		cwd = `${cwd}`.trim();
		cwd = cwd.length > 0 ? cwd : tmpDir;
		const resolve = (stdout: string) => {
			stdouts[i] = `${stdout}`;
		};
		const reject = (error: any) => {
			result.error(error?.stack || error?.message || `${error}`);
		};

		try {
			const process = exec(filledCommand, {cwd});
			process.child.stdout?.on('data', (buffer) => console.log(buffer.toString()));
			process.child.stderr?.on('data', (buffer) => {
				const data = buffer.toString();
				console.log(data);
				result.error(data);
			});

			if (options.parallelMode) {
				parallelPromises.push(
					process
						.then(({stdout}) => resolve(stdout))
						.catch(reject)
						.finally(() => {
							console.timeEnd(timeId);
						})
				);
			} else {
				const {stdout, stderr} = await process;
				resolve(stdout);
				if (stderr && !ignoreErrors) break;
			}
		} catch (error) {
			reject(error);
			if (!ignoreErrors) break;
		}
	}

	if (parallelPromises.length > 0) await Promise.all(parallelPromises);

	await cleanup();

	/**
	 * Construct results.
	 */
	for (let i = 0; i < resultTemplates.length; i++) {
		let {filledTemplate, type} = resultTemplates[i]!;
		// {stdout[:N][:RegExp]}
		// A copy of {stdout} token replacer from above, only changes are error messages and variable names
		const regExp = /(?<!\\)\{stdout(:(?<tokenIndex>\d+))?(:(?<tokenRegExp>.+?))?(?<!\\)\}/g;
		let match;
		const matchTarget = filledTemplate;
		while ((match = regExp.exec(matchTarget))) {
			const token = match[0]!;
			const tokenIndexStr = match.groups!.tokenIndex;
			const tokenIndex = tokenIndexStr ? parseInt(tokenIndexStr, 10) : null;
			const tokenRegExp = match.groups!.tokenRegExp;
			const stdout = tokenIndex != null ? stdouts[tokenIndex] : stdouts[stdouts.length - 1];

			if (stdout == null) {
				result.error(
					`Token "${token}" used in result template, but stdout for command[${tokenIndex}] is not available.`
				);
				return;
			}

			if (tokenRegExp) {
				const match = new RegExp(tokenRegExp.replaceAll('\\{', '{').replaceAll('\\}', '}'), 'is').exec(stdout);
				if (match) {
					const matchResult = match.groups?.result ?? match[0]!;
					filledTemplate = filledTemplate.replace(token, matchResult);
				} else {
					result.error(
						`Result template token "${token}" didn't match anything in command[${tokenIndex}] stdout.`
					);
					return;
				}
			} else {
				filledTemplate = filledTemplate.replace(token, stdout);
			}
		}

		filledTemplate = filledTemplate.trim();

		// Emit only when non empty string, unless string result type is requested,
		// in which case empty string might be a valid result.
		if (filledTemplate || type === 'string') {
			// Emit result
			result[type](filledTemplate || '');
		} else {
			result.error(`result[${i}] template produced an empty string.`);
		}
	}
};
