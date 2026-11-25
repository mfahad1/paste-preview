# paste-preview

A Claude Code mod that shows the images you paste into the prompt as pictures under your message in the chat. Without it, the chat only shows an `[Image #N]` label.

Each picture is drawn as a thumbnail in a rounded border, with its label under it. Several pictures sit side by side and only wrap to a new line when the next one won't fit in the terminal's width.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install paste-preview --marketplace mfahad1/paste-preview
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install paste-preview --marketplace mfahad1/paste-preview
```

## Requirements

- A terminal that draws images with the kitty graphics protocol, such as Ghostty or kitty.
- Claude Code's fullscreen layout. Set `"tui": "fullscreen"` in `~/.claude/settings.json`, or start Claude Code with `CLAUDE_CODE_NO_FLICKER=1`. In the normal layout the mod shows a one-line hint in place of the picture.
- macOS. The mod converts pasted images to PNG with `sips` and `base64`.

Images pasted before the mod loaded, or in an earlier session, are not shown. Converted images are kept in the plugin's data folder.
