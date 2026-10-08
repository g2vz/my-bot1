const {
    Client,
    GatewayIntentBits,
    REST,
    Routes
} = require("discord.js");

require("dotenv").config();

const talk = require("./talk");
const afk = require("./afk");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ======================================================
// COMMAND GROUPS
// ======================================================

const commandGroups = [
    ...(talk.commands || []),
    ...(afk.commands || [])
];

const seenCommandNames = new Set();
const allCommands = commandGroups.filter(command => {
    const commandName = command.name;

    if (seenCommandNames.has(commandName)) {
        return false;
    }

    seenCommandNames.add(commandName);
    return true;
});

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {

    console.log("--------------------------------");
    console.log("Nexona is online!");
    console.log(`Logged in as: ${client.user.tag}`);
    console.log(`Bot ID: ${client.user.id}`);
    console.log("--------------------------------");

    try {

        const rest = new REST({
            version: "10"
        }).setToken(TOKEN);

        // ==================================================
        // REGISTER ALL COMMANDS
        // ==================================================

        const commandData = allCommands.map(
            command => command.toJSON()
        );

        await rest.put(
            Routes.applicationCommands(CLIENT_ID),
            {
                body: commandData
            }
        );

        console.log(
            `Registered ${commandData.length} slash commands.`
        );

        for (
            const command
            of allCommands
        ) {
            console.log(
                `  /${command.name}`
            );
        }

    } catch (error) {

        console.error(
            "Failed to register slash commands:",
            error
        );

    }
});

// ======================================================
// INTERACTIONS
// ======================================================

client.on(
    "interactionCreate",
    async interaction => {

        try {

            // ==================================================
            // CHAT INPUT COMMANDS
            // ==================================================

            if (
                interaction.isChatInputCommand()
            ) {

                let handled = false;

                // Talk Command
                if (
                    talk.handleInteraction
                ) {

                    await talk.handleInteraction(
                        interaction,
                        client
                    );
                    handled = true;
                }

                // AFK Command
                if (
                    !handled &&
                    afk.handleInteraction
                ) {

                    await afk.handleInteraction(
                        interaction
                    );
                    handled = true;
                }

                return;
            }

        } catch (error) {

            console.error(
                "Interaction error:",
                error
            );

            try {

                if (
                    interaction.replied ||
                    interaction.deferred
                ) {

                    await interaction.followUp({
                        content:
                            "Something went wrong while executing this interaction.",
                        ephemeral: true
                    });

                } else {

                    await interaction.reply({
                        content:
                            "Something went wrong while executing this interaction.",
                        ephemeral: true
                    });

                }

            } catch (replyError) {

                console.error(
                    "Failed to send error response:",
                    replyError
                );

            }
        }
    }
);

// ======================================================
// ERRORS
// ======================================================

client.on(
    "error",
    error => {

        console.error(
            "Discord Client Error:",
            error
        );

    }
);

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "Unhandled Promise Rejection:",
            error
        );

    }
);

process.on(
    "uncaughtException",
    error => {

        console.error(
            "Uncaught Exception:",
            error
        );

    }
);

// ======================================================
// LOGIN
// ======================================================

if (!TOKEN) {

    console.error(
        "DISCORD_TOKEN is missing."
    );

    process.exit(1);
}

if (!CLIENT_ID) {

    console.error(
        "CLIENT_ID is missing."
    );

    process.exit(1);
}

client.login(TOKEN);
