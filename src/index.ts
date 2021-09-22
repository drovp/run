import {Plugin, PayloadData, OptionsSchema, makeAcceptsFlags} from '@drovp/types';

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
	resultMode: 'all' | 'any' | 'first';
};

const templateDescription = {
	file: 'Should produce a valid file path.',
	directory: 'Should produce a valid directory path.',
	url: 'Should produce a valid URL.',
	string: 'Should produce any string.',
};

const optionsSchema: OptionsSchema<Options> = [
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
				rows: 3,
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
		itemTitle: 'Command',
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
				}
				<h4>Available tokens:</h4>
				<p>
					Platform folders: <code>&lt;tmp&gt;</code>, <code>&lt;home&gt;</code>, <code>&lt;downloads&gt;</code>, <code>&lt;documents&gt;</code>, <code>&lt;pictures&gt;</code>, <code>&lt;music&gt;</code>, <code>&lt;videos&gt;</code>, <code>&lt;desktop&gt;</code><br>
					<code>&lt;path&gt;</code>, <code>&lt;url&gt;</code>, <code>&lt;string&gt;</code> - file/dir path, url, or string contents, depending on input type<br>
					<code>&lt;payload&gt;</code> - either <code>&lt;path&gt;</code>, <code>&lt;url&gt;</code>, or <code>&lt;string&gt;</code>, depending on item type<br>
					<code>&lt;basename&gt;</code> - path basename (<code>/foo/bar.jpg</code> → <code>bar.jpg</code>)<br>
					<code>&lt;filename&gt;</code> - file name without the extension<br>
					<code>&lt;extname&gt;</code> - file extension WITH the dot<br>
					<code>&lt;ext&gt;</code> - file extension without the dot<br>
					<code>&lt;dirname&gt;</code> - directory path (<code>/foo/bar/baz.jpg</code> → <code>/foo/bar</code>)<br>
					<code>&lt;dirbasename&gt;</code> - name of a parent directory (<code>/foo/bar/baz.jpg</code> → <code>bar</code>)<br>
					<code>&lt;stdout&gt;</code>, <code>&lt;stdout[N]&gt;</code> - stdout of the last or Nth command, starting at 0 (<code>&lt;stdout[0]&gt;</code>)<br>
					<code>&lt;stdout:RegExp&gt;</code>, <code>&lt;stdout[N]:RegExp&gt;</code> - <a href="https://regex101.com/">ECMAScript (JS) RegExp</a> match of the stdout of the last or Nth command.<br>
				</p>
				<ul>
					<li><code>&lt;&gt;:\\</code> characters have to be escaped with <code>\\&lt;\\&gt;\\:\\\\</code></li>
					<li>Use <code>(?\\&lt;result\\&gt;...)</code> named capture group to specify only the portion of the RegExp to extract, otherwise the whole match is going to be used.</li>
					<li>Example: if you're trying to match url in a string like <code>'url: https://example.com'</code> you'd use <code>&lt;stdout:url\\: *(?\\&lt;result\\&gt;https?:\/\/[^ ]+)&gt;</code></li>
					<li>Un-configured RegExp is created with <code>is</code> flags (case insensitive + dot matches new line).</li>
					<li>You can configure a RegExp by wrapping it in slashes: <code>&lt;stdout:/expression/im&gt;</code>.</li>
				</ul>`,
	},
	{
		name: 'resultTemplates',
		type: 'collection',
		title: 'Results',
		itemTitle: 'Result',
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
				rows: 2,
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
];

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
	strings: (item, options) =>
		item.type === 'text/plain' && options.inputTypes.includes('string') && satisfiesFilters(item.contents, options),
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
