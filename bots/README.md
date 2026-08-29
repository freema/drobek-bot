# bots

User bots live here, one folder per bot. The folder is bind-mounted into the worker as `/bots`. A bot's `memory/` folder is git-ignored: it is the bot's own working state, not part of the definition. The format of a bot folder is described in [docs/bot-format.md](../docs/bot-format.md). Five complete bots to copy from are in [examples/](./examples); the `examples` folder itself is not a bot.
