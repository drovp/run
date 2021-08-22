import {Plugin, PayloadData, makeOptionsSchema, makeAcceptsFlags} from '@drovp/types';

type Options = {
	inputTypes: 'file' | 'directory' | 'url' | 'string';
	includes: string[];
	excludes: string[];
	threadType: 'uncategorized' | 'cpu' | 'gpu' | 'download' | 'upload' | 'io' | 'custom';
	customThreadType: string;
	parallelMode: boolean;
	commands: {
		command: string;
		cwd: string;
		ignoreErrors: boolean;
	}[];
	resultTemplates: {
		type: 'file' | 'directory' | 'url' | 'string';
		template: string;
	}[];
};

const templateDescription = {
	file: 'Should produce a valid file path.',
	directory: 'Should produce a valid directory path.',
	url: 'Should produce a valid URL.',
	string: 'Should produce any string.',
};

const optionsSchema = makeOptionsSchema<Options>()([
	{
		name: 'inputTypes',
		type: 'select',
		options: ['file', 'directory', 'url', 'string'],
		default: ['file'],
		title: 'Input type',
		description: `What type of input should this profile accept.<br>
				Note: When file is enabled, directory is not, and directory is
				dragged in, it will be expanded and operation created for every file inside it.`,
	},
	{
		name: 'includes',
		type: 'list',
		schema: {type: 'string'},
		default: [],
		title: 'Includes',
		description: `Regular expressions the item payload (path, url, or string) HAS to match.`,
	},
	{
		name: 'excludes',
		type: 'list',
		schema: {type: 'string'},
		default: [],
		title: 'Excludes',
		description: `Regular expressions the item payload (path, url, or string) CAN'T match.`,
	},
	{
		name: 'threadType',
		type: 'select',
		options: ['uncategorized', 'cpu', 'gpu', 'download', 'upload', 'io', 'custom'],
		default: 'uncategorized',
		title: 'Thread type',
		description: `Informs the app which thread pool should the operations of this profile be drawing from.`,
	},
	{
		name: 'customThreadType',
		type: 'string',
		min: 1,
		title: 'Custom thread type',
		description: `Name a custom thread pool to use.`,
		isHidden: (_, {threadType}) => threadType !== 'custom',
	},
	{
		name: 'parallelMode',
		type: 'boolean',
		default: false,
		title: `Parallel mode`,
		description: `Run all commands at the same time.<br>In parallel mode, commands don't have access to <code>{stdout}</code> tokens.`,
	},
	{
		name: 'commands',
		type: 'collection',
		schema: [
			{
				name: 'command',
				type: 'string',
				lines: 3,
				title: 'Command',
			},
			{
				name: 'cwd',
				type: 'path',
				kind: 'directory',
				title: 'CWD',
			},
			{
				name: 'ignoreErrors',
				type: 'boolean',
				default: false,
				title: 'Ignore errors',
				isHidden: (_, options) => options.parallelMode,
			},
		],
		title: 'Commands',
		description: (value, options) =>
			`<p>List of commands to run one after another.</p>
				<p>New lines and indentation around them will be removed to construct a single command out of each textarea.
				This is so you can format and make a better sense out of big commands.</p>
				<p><b>CWD</b> - current working directory (supports tokens). By default, <b>run</b> sets it to a temporary
				folder created for each operation, and deletes it at the end of it.</p>
				${
					!options.parallelMode
						? `<p><b>Ignore errors</b> - <b>run</b> stops the chain, and won't emit results if any command emits errors,
				but some CLIs just can't help themselves to not abuse stderr for not actual errors, so just
				click this checkbox for those.</p>`
						: ''
				}`,
	},
	{
		type: 'divider',
		description: `
				<h4>Available tokens:</h4>
				<p>
					<code>{path}</code>, <code>{url}</code>, <code>{string}</code> - file/dir path, url, or string contents, depending on input type<br>
					<code>{payload}</code> - if you've enabled more than one type input, this is either path, url, or string<br>
					<code>{basename}</code> - path basename (<code>/foo/bar.jpg</code> → <code>bar.jpg</code>)<br>
					<code>{filename}</code> - file name without the extension<br>
					<code>{extname}</code> - file extension WITH the dot<br>
					<code>{ext}</code> - file extension without the dot<br>
					<code>{dirname}</code> - directory path (<code>/foo/bar/baz.jpg</code> → <code>/foo/bar</code>)<br>
					<code>{dirbasename}</code> - name of a parent directory (<code>/foo/bar/baz.jpg</code> → <code>bar</code>)<br>
					<code>{stdout}</code>, <code>{stdout:N}</code> - stdout of the last or Nth command, starting at 0 (<code>{stdout:0}</code>)<br>
					<code>{stdout:RegExp}</code>, <code>{stdout:N:RegExp}</code> - <a href="https://regex101.com/">ECMAScript (JS) RegExp</a> match of the stdout of the last or Nth command.<br>
				</p>
				<ul>
					<li>RegExp is created with <code>is</code> flags.</li>
					<li>Use <code>(?&lt;result&gt;...)</code> named capture group to specify only the portion of the RegExp to extract, otherwise the whole match is going to be used.</li>
					<li><code>{}</code> characters have to be escaped with <code>\\{\\}</code></li>
					<li>Example: if you're trying to match url in a string like <code>'url: https://example.com'</code> you'd write <code>{stdout:url: *(?&lt;result&gt;https?:\/\/[^ ]+)}</code></li>
				</ul>`,
	},
	{
		name: 'resultTemplates',
		type: 'collection',
		title: 'Results',
		description: `Templates to emit one or multiple results after everything's done.`,
		schema: [
			{
				name: 'type',
				type: 'select',
				options: ['file', 'directory', 'url', 'string'],
				default: 'file',
				title: 'Type',
			},
			{
				name: 'template',
				type: 'string',
				lines: 2,
				default: '',
				title: 'Template',
				description: (_, {resultTemplates}, path) =>
					`${
						templateDescription[resultTemplates[path[1] as number]!.type]
					} Supports same tokens as commands.`,
			},
		],
		default: [],
	},
	{
		name: 'resultMode',
		type: 'select',
		options: ['all', 'any', 'first'],
		default: 'all',
		title: 'Emitting mode',
		description: (value) =>
			value === 'all'
				? `Emit all templates. The ones that didn't produce anything will be emitted as errors.`
				: value === 'any'
				? `Emit only templates that produced something.`
				: `Emit only the first template that produced something.`,
		isHidden: (_, options) => options.resultTemplates.length === 0,
	},
]);

function satisfiesFilters(value: string, options: Options) {
	for (const filter of options.includes) {
		if (new RegExp(filter).exec(value) == null) return false;
	}

	for (const filter of options.excludes) {
		if (new RegExp(filter).exec(value) != null) return false;
	}

	return true;
}

const acceptsFlags = makeAcceptsFlags<Options>()({
	files: (item, options) => options.inputTypes.includes('file') && satisfiesFilters(item.path, options),
	directories: (item, options) => options.inputTypes.includes('directory') && satisfiesFilters(item.path, options),
	urls: (item, options) => options.inputTypes.includes('url') && satisfiesFilters(item.url, options),
	strings: (item, options) => options.inputTypes.includes('string') && satisfiesFilters(item.contents, options),
});

export type Payload = PayloadData<Options, typeof acceptsFlags>;

export default (plugin: Plugin) => {
	plugin.registerProcessor<Payload>('run', {
		main: 'dist/processor.js',
		description: 'Executes one or multiple console commands on dropped items.',
		accepts: acceptsFlags,
		threadType: ({options: {threadType, customThreadType}}) =>
			threadType === 'custom' ? customThreadType : threadType,
		parallelize: true,
		options: optionsSchema,
	});
};
