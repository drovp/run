import type {ProcessorUtils} from '@drovp/types';
import type {Payload} from './';
import * as OS from 'os';
import * as Path from 'path';
import * as CP from 'child_process';
import {promisify} from 'util';
import {promises as FSP} from 'fs';
import {isPlatformPathIdentifier, getPlatformPath} from 'platform-paths';

const exec = promisify(CP.exec);

function eem(error: any, preferStack = false) {
	return error instanceof Error ? (preferStack ? error.stack || error.message : error.message) : `${error}`;
}

export default async function ({id, item, options}: Payload, {stage, result}: ProcessorUtils) {
	const staticValues: Record<string, string> = {};
	const stdouts: string[] = [];
	const {commands, resultTemplates, resultMode} = options;

	switch (item.kind) {
		case 'directory':
		case 'file': {
			const extname = Path.extname(item.path);
			const dirname = Path.dirname(item.path);
			Object.assign(staticValues, {
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
			Object.assign(staticValues, {
				string: item.contents,
				payload: item.contents,
			});
			break;
		case 'url':
			Object.assign(staticValues, {
				url: item.url,
				payload: item.url,
			});
			break;
	}

	// Create temporary directory
	const tmpDir = Path.join(OS.tmpdir(), `drovp-run-operation-${id}`);
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
		let {command, cwd, ignoreErrors} = commands[i]!;

		if (!options.parallelMode) stage(`${i + 1}/${options.commands.length}`);

		// Fill the command template
		let filledCommand: string | undefined;
		try {
			filledCommand = await detokenize(`command[${i}]`, parseTemplate(command), staticValues, stdouts);
		} catch (error) {
			throw new Error(`command[${i}] template error: ${eem(error)}`);
		}

		if (!filledCommand) throw new Error(`command[${i}]: template produced an empty command`);

		// Execute the command
		console.log(
			`===== COMMAND[${i}]: ==========\n${command}\n----- FILLED: --------------\n${filledCommand}\n============================`
		);
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
				console.error(data);
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
	 * Emit results.
	 */
	for (let i = 0; i < options.resultTemplates.length; i++) {
		let {template, type} = resultTemplates[i]!;

		let filledTemplate: string | undefined;
		try {
			filledTemplate = await detokenize(`result[${i}]`, parseTemplate(template), staticValues, stdouts);
		} catch (error) {
			throw new Error(`result[${i}] template error: ${eem(error)}`);
		}

		if (filledTemplate) {
			result[type](filledTemplate || '');
			if (resultMode === 'first') break;
		} else {
			if (resultMode === 'all') result.error(`result[${i}] template produced an empty string.`);
		}
	}
}

/**
 * Template parser.
 */

type TokenString = {
	index: number;
	line: number;
	column: number;
	type: 'string';
	value: string;
};
type TokenValue = {
	index: number;
	line: number;
	column: number;
	type: 'value';
	name: string;
	prop?: string;
	args: string[];
};
type Token = TokenString | TokenValue;

function parseTemplate(
	template: string,
	{valueStart = '<', valueEnd = '>', propStart = '[', propEnd = ']', argSeparator = ':', escapeChar = '\\'} = {}
): Token[] {
	const tokens: Token[] = [];
	let currentToken: Token | null = null;
	let line = 0;
	let column = 0;

	for (let i = 0; i < template.length; i++) {
		const char = template[i];
		const escaped = template[i - 1] === escapeChar;

		if (char === '\n') {
			line++;
			column = 0;
		} else {
			column++;
		}

		if (char === escapeChar) continue;

		if (char === valueStart && !escaped) {
			if (currentToken?.type === 'value') {
				throw new Error(
					`char[${i}] (${template.slice(i, i + 5)}…) starts a value, while the one at char[${
						currentToken.index
					}] (${template.slice(currentToken.index, currentToken.index + 5)}…) hasn't been terminated.`
				);
			}
			currentToken = {type: 'value', name: '', args: [], index: i, line, column};
			tokens.push(currentToken);
			continue;
		}

		if (!currentToken) {
			currentToken = {type: 'string', value: '', index: i, line, column};
			tokens.push(currentToken);
		}

		if (currentToken.type === 'string') {
			currentToken.value += char;
			continue;
		}

		if (char === valueEnd && !escaped) {
			currentToken = null;
			continue;
		} else if (i + 1 >= template.length) {
			throw new Error(
				`template ends before value token "${currentToken.name}" at ${currentToken.line}:${currentToken.column} is closed`
			);
		}

		if (char === argSeparator && !escaped) {
			currentToken.args.push('');
			continue;
		}

		if (char === propStart && !escaped) {
			currentToken.prop = '';
			continue;
		}

		if (char === propEnd && !escaped) {
			if (!currentToken.prop) {
				throw new Error(`char[${i}] token "${template.slice(currentToken.index, i)}}" property is empty`);
			}

			const nextChar = template[i + 1];

			if (nextChar !== argSeparator && nextChar !== valueEnd) {
				throw new Error(
					`char[${i + 1}] invalid character "${nextChar}" after value property (${template.slice(
						currentToken.index,
						i + 1
					)})`
				);
			}

			continue;
		}

		if (currentToken.args.length > 0) {
			currentToken.args[currentToken.args.length - 1] += char;
		} else if (currentToken.prop != null) {
			currentToken.prop += char;
		} else {
			currentToken.name += char;
		}
	}

	// Remove new lines and decorative white space around them from string tokens
	for (const token of tokens) {
		if (token.type === 'string') token.value = token.value.replaceAll(/\s*(\^|\\)?\n\s*/g, ' ');
	}

	return tokens;
}

/**
 * Detokenizer.
 */
async function detokenize(namespace: string, tokens: Token[], staticValues: Record<string, string>, stdouts: string[]) {
	let result = '';

	for (const token of tokens) {
		const position = `${token.line}:${token.column}`;

		if (token.type === 'string') {
			result += token.value;
			continue;
		}

		// Stdout
		if (token.name === 'stdout') {
			const tokenStr = token.args.length > 0 ? `<stdout:${token.args.join(':')}>` : `<stdout>`;
			let stdoutIndex: number = (token.prop ?? stdouts.length - 1) as number;
			let regExpStr: string | undefined = token.args[0];

			if (token.args.length > 1) {
				throw new Error(
					`${namespace}: token at ${position} has too many arguments:\n\n${tokenStr}\n\nMaybe unescaped colon?`
				);
			}

			const stdout = stdouts[stdoutIndex!];

			if (!stdout)
				throw new Error(
					`${namespace}: token at ${position}:\n\n${tokenStr}\n\nreferences non-existent stdout index "${stdoutIndex}".`
				);

			if (regExpStr) {
				const config = /^\/(?<expression>.*)\/(?<flags>\w*)$/.exec(regExpStr)?.groups;
				const regExp = config
					? new RegExp(config.expression!, config.flags || undefined)
					: new RegExp(regExpStr, 'is');
				const match = regExp.exec(stdout);

				if (!match) {
					throw new Error(
						`${namespace}: stdout token expression at ${position}:\n\n${tokenStr}\n\ndidn't match any result. stdout[${stdoutIndex}] (first 1000 chars):\n\n${stdout.slice(
							0,
							1000
						)}`
					);
				}

				result += match.groups?.result ?? match[0]!;
				continue;
			}

			result += stdout;
			continue;
		}

		// Static values
		const staticValue = staticValues[token.name];
		if (staticValue) {
			result += staticValue;
			continue;
		}

		// Platform paths
		if (isPlatformPathIdentifier(token.name)) {
			const path = await getPlatformPath(token.name);
			if (path) {
				result += path;
				continue;
			}
		}

		throw new Error(`${namespace}: value of token "<${token.name}>" at ${position} is empty.`);
	}

	return result.trim();
}
