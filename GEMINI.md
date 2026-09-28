# Global Gemini Instructions

Apply these rules to all projects unless project-specific instructions explicitly override them.

## Core rule

Make only the changes required by the user's request.

Do not improve, clean up, reorganize, refactor, simplify, rename, move, or delete unrelated code.

Existing working code should be treated as intentional unless there is clear evidence that it must be changed for the requested task.

## Strict scope

* Work only on the requested feature or bug.
* Modify the minimum number of files necessary.
* Do not inspect unrelated parts of the repository without a concrete reason.
* Do not search for additional problems to fix.
* Do not turn a small task into a larger refactor.
* If you notice an unrelated issue, mention it instead of modifying it.

## Never delete without explicit justification

Do not delete any existing:

* file;
* component;
* function;
* variable;
* field;
* database column;
* UI element;
* route;
* configuration;
* dependency;
* stored-data handling;
* test;
* feature;

unless deletion is explicitly requested or is strictly necessary for the requested change.

Before deleting existing functionality, verify that it is genuinely unused and that the requested task requires its removal.

When uncertain, preserve it.

**Prefer leaving unnecessary existing code intact over accidentally deleting functionality.**

## Preserve user work

Assume existing code and uncommitted changes may belong to the user or another agent.

* Never revert changes you did not create.
* Never overwrite unrelated modifications.
* Never discard a dirty working tree.
* Never restore files to an earlier version just because the current version looks unusual.
* Adapt your changes around existing work whenever possible.

## No unsolicited refactoring

Do not refactor code merely because:

* another design looks cleaner;
* you prefer another implementation;
* the code could be shorter;
* naming could be improved;
* architecture could be modernized.

Refactor only when required to implement the requested task safely.

## Repository exploration

Start with the files directly related to the request.

* Do not scan the whole repository by default.
* Do not repeatedly reread unchanged files.
* Do not repeatedly search for the same symbols.
* Reuse context already gathered during the task.
* Expand investigation only when necessary for correctness.

## Dependencies

Do not add, remove, replace, or upgrade dependencies unless necessary for the requested task.

Do not regenerate lock files unnecessarily.

Prefer existing project functionality and dependencies.

## Git safety

Never perform destructive Git operations unless explicitly requested.

Do not automatically use commands that:

* reset branches;
* discard local changes;
* delete untracked files;
* rewrite history;
* force push;
* restore modified files;
* delete branches.

In particular, do not use destructive operations such as:

`git reset --hard`
`git clean -fd`
`git push --force`

without explicit user instruction.

## Data safety

Never silently:

* delete stored data;
* reset application state;
* remove fields from saved records;
* change data formats incompatibly;
* truncate databases;
* perform destructive migrations.

Preserve backward compatibility whenever reasonably possible.

## Verification

After implementing the requested change:

* perform one focused verification pass;
* verify only the affected functionality;
* do not repeatedly rebuild or retest successful code without a reason;
* do not modify unrelated code because of warnings that are unrelated to the task.

If verification passes, stop.

## When uncertain

When several solutions are possible, prefer:

1. preserving existing behavior;
2. fewer changes;
3. lower regression risk;
4. simpler implementation;
5. reversible changes.

If you are unsure whether something should be removed or replaced:

**do not remove or replace it.**

## Final behavior

The normal workflow should be:

1. Understand the requested change.
2. Locate the minimum relevant code.
3. Make the smallest correct modification.
4. Preserve everything unrelated.
5. Run one relevant verification.
6. Report what changed.
7. Stop.

**Do not touch code simply because you can.**
**Do not delete existing functionality unless the task genuinely requires it.**
**When in doubt, preserve existing code and user changes.**
