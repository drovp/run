# @drovp/run

[Drovp](https://drovp.app) plugin to execute one or a series of console commands on dropped items.

Features:

-   Powerful command templating using JavaScript template literals.
-   Ability to set current working directory per command (supports templates).
-   Generate output items after commands have completed (more templates).
-   All templates have access to stdouts of previous commands.

## Templates

Templates are JavaScript template literals allowing embedded expressions.

_All variables and utilities available in templates are documented in profile's instructions._

### Examples

Basic command template using a variable and a utility call:

```
binary-name "${path}" --param ${uid(5)}
```

---

You can use new lines and indentation to visually separate parameters, they'll be removed when expanding the template:

```
binary-name "${path}"
  --param ${uid(5)}
  --param2 ${Time(starttime).format(YYYY)}
```

New line terminal escapes `\` and `^` are also supported, so you can just paste in already existing commands.

---

Expressions are powerful:

```
binary-name
  "${stdout.match(/^\[path\]([^\n]+)$/m)[1].trim()}"
  --param "${filename.toUpperCase()}"
```

`stdout` is a reference to the stdout output of the previous command. Other stdouts are available on the `stdouts[]` array. In the example above, we are using regular expression to extract path from an stdout line such as `[path] /path/to/file` to use in the current command.

---

You can enable bulked mode to group all items dropped into the profile into a single operation.

_Default behavior is to split all dropped items into separate operations._

These items will then be available inside templates on the `inputs[]` array, which can then be used to do stuff like concatenating dropped files using ffmpeg:

```
ffmpeg
	-i "concat:${inputs.map(f => f.basename).join('|')}"
	-codec copy
	"${inputs[0].filename}-concat.${inputs[0].ext}"
```

Example above requires command **CWD** to be set to `${commondir}`.
