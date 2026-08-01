# CasinoBot

A self-hostable, multi-server Discord casino using virtual chips. CasinoBot
includes blackjack, coin flip, dice, slots, crash, roulette, shared server
leaderboards, daily rewards, transfers, statistics, and optional reminders.

It can also publish the prompt from [Daily Dilemma](https://dailydilemma.fun)
to a channel in each server, helping the daily question travel between
communities. No real money or cryptocurrency is involved.

## How deployment works

Each operator creates their own Discord application and keeps its token in a
local `.env` file. One running CasinoBot instance can serve multiple Discord
servers: balances, games, channels, reminders, and timezones are isolated by
server ID.

Never commit a bot token. If one is exposed, reset it immediately in the
Discord Developer Portal.

## Discord application setup

1. Create an application in the
   [Discord Developer Portal](https://discord.com/developers/applications).
2. Open **Bot**, create the bot user, and enable **Server Members Intent**.
3. Copy `.env.example` to `.env`. Add the bot token and application ID.
4. Under **OAuth2 → URL Generator**, select the `bot` and
   `applications.commands` scopes. Grant these bot permissions:
   **View Channels**, **Send Messages**, **Embed Links**, and
   **Read Message History**.
5. Open the generated URL to invite the bot to each server.

## Run with Docker Compose

Docker Compose is the simplest production setup:

```sh
cp .env.example .env
# Edit .env with your Discord token and application ID.
docker compose build
docker compose run --rm casinobot npm run commands:register
docker compose up -d
```

The named Docker volume preserves the SQLite database across updates and
container recreation.

## Run directly with Node.js

Node.js 22 or newer is required.

```sh
cp .env.example .env
npm ci
npm run prisma:generate
npm run db:migrate
npm run commands:register
npm run build
npm start
```

Set `DISCORD_GUILD_ID` while developing to register commands instantly in one
test server. Leave it empty for global commands; Discord can take up to an hour
to publish global command changes.

A sample systemd unit is available at `deploy/casinobot.service`. It assumes
the repository is installed at `/opt/casinobot`, its `.env` file is present,
dependencies are installed, and a restricted `casinobot` system user exists.

## Configure each Discord server

Server administrators configure optional announcements through slash commands:

```text
/casino setup dilemma-channel channel:#daily-dilemma
/casino setup reminder-channel channel:#casino
/casino setup timezone timezone:America/Toronto
```

Run either channel command without selecting a channel to disable that feature.
Daily Dilemma prompts publish shortly after 12:05 AM in the configured timezone;
casino reminders publish during the 9 PM hour. Members can opt out of reminder
mentions with `/casino notifications setting:Off`.

`DAILY_DILEMMA_API_KEY` is optional. Without it, the prompt, choices, and link
still appear, but members vote on the Daily Dilemma website instead of using
buttons inside Discord.

## Commands and games

- Account: `balance`, `daily`, `stats`, `history`, `leaderboard`, `transfer`
- Preferences: `notifications`, `odds`
- Games: `blackjack`, `coinflip`, `dice`, `slots`, `crash`, `roulette`
- Administration: `setup dilemma-channel`, `setup reminder-channel`, `setup timezone`

All wagers use free virtual chips. New players begin with 1,000 chips.

## Development

```sh
npm run typecheck
npm test
npm run build
```

The SQLite schema and initial migration are under `prisma/`. Casino settlements
use unique Discord interaction IDs so retried interactions cannot pay twice.

## License

MIT. See `LICENSE`.
