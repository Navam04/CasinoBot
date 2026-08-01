CREATE TABLE "GuildSetting" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "dilemmaChannelId" TEXT,
    "casinoReminderChannelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "CasinoAccount" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 1000,
    "activeBlackjackGameId" INTEGER,
    "lastDailyAt" DATETIME,
    "lastGambledAt" DATETIME,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "BlackjackGame" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "operationId" TEXT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wager" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deck" TEXT NOT NULL,
    "playerHand" TEXT NOT NULL,
    "dealerHand" TEXT NOT NULL,
    "payout" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
);

CREATE TABLE "CasinoTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "operationId" TEXT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "wager" INTEGER NOT NULL DEFAULT 0,
    "payout" INTEGER NOT NULL DEFAULT 0,
    "delta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CasinoAnnouncement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME
);

CREATE TABLE "IntegrationState" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "CasinoAccount_guildId_userId_key" ON "CasinoAccount"("guildId", "userId");
CREATE INDEX "CasinoAccount_guildId_balance_idx" ON "CasinoAccount"("guildId", "balance");
CREATE INDEX "CasinoAccount_guildId_lastGambledAt_idx" ON "CasinoAccount"("guildId", "lastGambledAt");
CREATE UNIQUE INDEX "BlackjackGame_operationId_key" ON "BlackjackGame"("operationId");
CREATE INDEX "BlackjackGame_guildId_userId_status_idx" ON "BlackjackGame"("guildId", "userId", "status");
CREATE UNIQUE INDEX "CasinoTransaction_operationId_key" ON "CasinoTransaction"("operationId");
CREATE INDEX "CasinoTransaction_guildId_userId_createdAt_idx" ON "CasinoTransaction"("guildId", "userId", "createdAt");
CREATE UNIQUE INDEX "CasinoAnnouncement_guildId_localDate_key" ON "CasinoAnnouncement"("guildId", "localDate");
