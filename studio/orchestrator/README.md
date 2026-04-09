# Agent Orchestrator

This directory contains the dispatch system for spinning up real AI subagents.

## How It Works

The **Studio Director** (the main Claude conversation) acts as the hub. When work needs to be done:

1. Director reads the relevant `role.md` for the agent being dispatched
2. Director reads the task from the taskboard
3. Director spins up a subagent using the Agent tool with:
   - The agent's role context
   - The specific task to complete
   - Relevant file paths and constraints
4. Subagent works independently in the codebase
5. Results come back to the Director for review

## Dispatch Profiles

Each `.prompt.md` file in this directory is a dispatch template for a specific agent. They contain:
- Role context (from role.md)
- Working scope (which files they can touch)
- Constraints and standards
- How to report back

## Scaling

- Spin up multiple agents in parallel for independent tasks
- Use `isolation: "worktree"` for agents that might conflict on the same files
- For dependent tasks, run sequentially and pass context between agents

## Agent Status Tracking

After dispatch, update `studio/taskboard/BOARD.md` to reflect:
- Task moved from Backlog → In Progress (when agent starts)
- Task moved from In Progress → Review (when agent completes)
- Task moved from Review → Done (after Director approves)
