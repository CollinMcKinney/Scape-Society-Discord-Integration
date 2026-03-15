
So the overall idea is that players in a clan on Runelite can sync messages
between their clan CC and a discod server channel.

When someone sends a message on discord our bot will use WebSockets to update our Chat Server's redis database.

When someone is online in runelite, we have a plugin for runelite that reads messages from our redis chat server, and injects them into the in-game chat so players in game can see discord messages.

The messages that an online player in runelite sees or types themselves are
also uploaded to the redis chat servr database, and forwarded to a discord bot, the discord bot then uses webhooks to "impersonate" whoever originally sent the message.
