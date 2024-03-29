## Templates

Templates are JavaScript template literals allowing embedded expressions with access to a lot of useful variables and utilities. Example:

```
binary-name "${path}" --param ${uid(5)}
```

You can use new lines and indentation to visually separate parameters, they'll be removed when expanding the template:

```
binary-name "${path}"
  --param ${uid(5)}
  --param2 ${time(starttime).format(YYYY)}
```

New line terminal escapes `\` and `^` are also supported, so you can just paste in already existing commands.

### File/Directory variables

`path` - file/directory path → `/foo/fam/bar.jpg`\
`basename` - path basename → `bar.jpg`\
`filename` - file name without the extension → `bar`\
`extname` - file extension WITH the dot → `.jpg`\
`ext` - file extension without the dot → `jpg`\
`dirname` - directory path → `/foo/fam`\
`dirbasename` - basename of a parent directory → `fam`

### URL variables

`url` - URL → `https://john:horses@example.com/foo/bar`\
`origin` - URL origin → `https://example.com`\
`hostname` - domain → `example.com`\
`pathname` - pathname → `/foo/bar`\
`username` - username specified before the domain name → `john`\
`password` - password specified before the domain name → `horses`

### String variables

`contents` - string contents

### Common variables

`payload` - either `path`, `url`, or `contents`, depending on input item type\
`type` - item type `file/directory/url/string`\
`cwd` - path to current working directory\
`stdout` - stdout of the previous command\
`stdouts[]` - an array of all previous stdouts (unavailable in parallel mode)\
`stderr` - stderr of the previous command\
`stderrs[]` - an array of all previous stderrs (unavailable in parallel mode)\
`commondir` - in bulked files mode, this is the common directory for all input files\
`starttime` - time when operation started in unix epoch milliseconds

Platform folders:\
`tmp`, `home`, `downloads`, `documents`, `pictures`, `music`, `videos`, `desktop`

### Utilities

`Path` - Reference to [Node.js' `path` module](https://nodejs.org/api/path.html). Example: `Path.relative(foo, bar)`\
`Time()` - [day.js](https://day.js.org/docs/en/display/format) util to help with time. Example: `Time().format('YY')`\
`uid(size? = 10)` - Unique string generator. Size is optional, default is 10. Example: `uid()`

## Bulked mode

In bulked mode, all item related variables (`payload`, `path`, ...) are missing, and only available on an `inputs[i]` array as individual items.

Example to concatenate all passed videos into one using ffmpeg:

```
ffmpeg
	-i "concat:${inputs.map(f => f.basename).join('|')}"
	-codec copy
	"${inputs[0].filename}-concat.${inputs[0].ext}"
```

Example above requires command **CWD** to be set to `commondir`.
