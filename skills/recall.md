Search the vault for: $ARGUMENTS

1. In parallel, call:
   - mcp__jarvis__search_content with query="$ARGUMENTS" and max_results=5
   - mcp__jarvis__search_filename with query="$ARGUMENTS"

2. Merge results. Deduplicate by file path (content match takes priority). Keep up to 5 unique results.

3. Show total match count on the first line: "X result(s) found."

4. Present each result as:
**[path]** · [date from frontmatter if available]
> [snippet]

5. **Connected memory (1-hop).** Pass the file paths of the top 3 results (verbatim, each quoted) to the neighborhood resolver — run with the PowerShell tool, NOT Bash:
```powershell
node "C:\Users\<you>\Active Projects\Jarvis\mcp\scripts\recall-links.js" "{path1}" "{path2}" "{path3}"
```
It returns each hit's linked neighbors — outbound links AND backlinks — already grouped by memory role (Working / Episodic / Semantic / Index). Present its output verbatim under a `**Connected**` heading. If it prints `(no linked neighbors)`, omit the section. This surfaces memory connected to the match (the [[links]] made traversable), not just the match itself.

6. If neither search returns results, say so plainly and skip step 5.

Do not add padding, suggestions, or follow-up commentary.
