# Working agreements for Claude

- **Large blocks, few requests.** Make changes as complete blocks — whole files or whole sections — instead of many small edits, so the user approves as few tool calls as possible. Gather facts in one or two combined commands, not a series of small ones.
- **Large commits.** Commit only at milestones: one commit per finished piece of work (a package or feature that builds and passes its tests), never one per step, fix or review round. Fold follow-up fixes and small related changes into the commit they belong to — amend or squash locally before pushing instead of adding a fix-up commit.
- **Pull requests are the user's.** The user creates every pull request by hand. Claude never creates, edits, marks ready, closes or merges a pull request (no `gh pr create`, `gh pr edit`, `gh pr ready` and the like). When an iteration is ready, Claude pushes the branch, tells the user that it is time to open the PR and from which branch into `main`, and gives a title and description to paste.
- **One pull request per iteration.** `main` is protected (changes go through a PR only); the user merges.
- **Language.** User-facing text is Russian. Code, identifiers, comments, commit messages and PR descriptions are English.
- **Commit email.** This repository uses the GitHub noreply address set in `.git/config`; never commit with another address.
