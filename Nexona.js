const {
    Client,
    GatewayIntentBits,
    REST,
    Routes
} = require("discord.js");

require("dotenv").config();

// ======================================================
// COMMAND MODULES
// ======================================================

const talk = require("./talk");
const mamboSleep = require("./mambo-sleep");

// ======================================================
// CLIENT
// ======================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// ======================================================
// ENVIRONMENT VARIABLES
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ======================================================
// COMMAND GROUPS
// ======================================================

const commandGroups = [
    ...(talk.commands || []),
    ...(mamboSleep.commands || [])
];

// Prevent duplicate slash command names
const seenCommandNames = new Set();

const allCommands = commandGroups.filter(command => {
    if (!command || !command.name) {
        return false;
    }

    if (seenCommandNames.has(command.name)) {
        console.warn(
            `Duplicate command ignored: /${command.name}`
        );

        return false;
    }

    seenCommandNames.add(command.name);
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

        for (const command of allCommands) {
            console.log(`  /${command.name}`);
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

client.on("interactionCreate", async interaction => {
    try {
        // --------------------------------------------------
        // MAMBO SLEEP
        // Handles slash commands, channel selection and buttons
        // --------------------------------------------------

        if (mamboSleep.handleInteraction) {
            const handled =
                await mamboSleep.handleInteraction(interaction);

            if (handled) {
                return;
            }
        }

        // --------------------------------------------------
        // TALK COMMANDS
        // --------------------------------------------------

        if (interaction.isChatInputCommand()) {
            if (talk.handleInteraction) {
                await talk.handleInteraction(
                    interaction,
                    client
                );
            }

            return;
        }

    } catch (error) {
        console.error(
            "Interaction error:",
            error
        );

        const errorMessage =
            "Something went wrong while executing this interaction.";

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: errorMessage,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: errorMessage,
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
});

// ======================================================
// DISCORD CLIENT ERRORS
// ======================================================

client.on("error", error => {
    console.error(
        "Discord Client Error:",
        error
    );
});

// ======================================================
// PROCESS ERRORS
// ======================================================

process.on("unhandledRejection", error => {
    console.error(
        "Unhandled Promise Rejection:",
        error
    );
});

process.on("uncaughtException", error => {
    console.error(
        "Uncaught Exception:",
        error
    );
});

// ======================================================
// LOGIN VALIDATION
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

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);