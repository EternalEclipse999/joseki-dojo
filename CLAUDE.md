# Working agreements for Claude

- **Large blocks, few requests.** Make changes as complete blocks — whole files or whole sections — instead of many small edits, so the user approves as few tool calls as possible. Gather facts in one or two combined commands, not a series of small ones.
- **Few commits.** Commit at milestones, not after every step: one commit per coherent piece (a package or feature that builds and passes its tests). Never make a commit just to fix up the previous one — amend locally before pushing instead.
- **One pull request per iteration.** `main` is protected (changes go through a PR only); the user merges.
- **Language.** User-facing text is Russian. Code, identifiers, comments, commit messages and PR descriptions are English.
- **Commit email.** This repository uses the GitHub noreply address set in `.git/config`; never commit with another address.
