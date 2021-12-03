import {Plugin, PayloadData, OptionsSchema, makeAcceptsFlags} from '@drovp/types';

type Options = {
	inputTypes: 'file' | 'directory' | 'url' | 'string';
	bulk: boolean;
	includes: string[];
	excludes: string[];
	threadType: 'uncategorized' | 'cpu' | 'gpu' | 'download' | 'upload' | 'io' | 'custom';
	customThreadType: string;
	parallelMode: boolean;
	commands: {
		template: string;
		cwd: string;
		ignoreErrors: boolean;
	}[];
	outputs: {
		type: 'file' | 'directory' | 'url' | 'string';
		template: string;
	}[];
	outputMode: 'all' | 'any' | 'first';
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
		name: 'bulk',
		type: 'boolean',
		default: false,
		title: `Bulk inputs`,
		description: `Bulk all dropped inputs into one operation instead of splitting each into its own. In bulked mode all input related variables are accessible via <code>\${inputs[0].basename}</code>, instead of directly <code>\${basename}</code>`,
	},
	{
		name: 'parallelMode',
		type: 'boolean',
		default: false,
		title: `Parallel mode`,
		description: `Run all commands at the same time.<br>In parallel mode, command templates don't have access to <code>stdouts[]</code> variable.`,
	},
	{
		name: 'commands',
		type: 'collection',
		schema: [
			{
				name: 'template',
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
			<p><b>Command</b> and <b>CWD</b> fields are templates supporting JavaScript template literals. See instructions for documentation.</p>
			<p><b>CWD</b> - current working directory. By default, <b>run</b> sets it to a temporary
			folder created for each operation, and deletes it at the end of it.</p>
			${
				!options.parallelMode
					? `<p><b>Ignore errors</b> - by default, <b>run</b> stops the chain, and won't emit outputs if command errors out. Enable this if errors are expected for current command.</p>`
					: ''
			}`,
	},
	{
		name: 'outputs',
		type: 'collection',
		title: 'Outputs',
		itemTitle: 'Output',
		description: `Templates to emit outputs after everything's done. See instructions for documentation.`,
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
				description: (_, {outputs}, path) =>
					`${templateDescription[outputs[path[1] as number]!.type]} Supports same tokens as commands.`,
			},
		],
		default: [],
	},
	{
		name: 'outputMode',
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
		isHidden: (_, options) => options.outputs.length === 0,
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
		name: 'includes',
		type: 'list',
		schema: {type: 'string'},
		default: [],
		title: 'Includes',
		description: `Regular expressions the item payload (path, url, or string) HAS to match for an operation to be created for it.`,
	},
	{
		name: 'excludes',
		type: 'list',
		schema: {type: 'string'},
		default: [],
		title: 'Excludes',
		description: `Regular expressions the item payload (path, url, or string) CAN'T match for an operation to be created for it.`,
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
		instructions: 'instructions.md',
		description: 'Executes one or multiple console commands on dropped items.',
		accepts: acceptsFlags,
		bulk: (items, options) => options.bulk,
		threadType: ({options: {threadType, customThreadType}}) =>
			threadType === 'custom' ? customThreadType : threadType,
		parallelize: true,
		options: optionsSchema,
	});
};
