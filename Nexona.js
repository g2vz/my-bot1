const {
    Client,
    GatewayIntentBits,
    REST,
    Routes
} = require("discord.js");

require("dotenv").config();

const automod = require("./automod");
const automod2 = require("./automod2");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {
    console.log("--------------------------------");
    console.log(`Nexona is online!`);
    console.log(`Logged in as: ${client.user.tag}`);
    console.log(`Bot ID: ${client.user.id}`);
    console.log("--------------------------------");

    try {
        const rest = new REST({
            version: "10"
        }).setToken(TOKEN);

        const commandData =
            automod.commands.map(command =>
                command.toJSON()
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
    if (!interaction.isChatInputCommand()) {
        return;
    }

    try {
        await automod.handleCommand(
            interaction
        );
    } catch (error) {
        console.error(
            "Command error:",
            error
        );

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content:
                    "Something went wrong while executing this command.",
                ephemeral: true
            }).catch(() => {});
        } else {
            await interaction.reply({
                content:
                    "Something went wrong while executing this command.",
                ephemeral: true
            }).catch(() => {});
        }
    }
});

// ======================================================
// MESSAGES
// ======================================================

client.on("messageCreate", async message => {
    try {
        await automod.handleMessage(
            message
        );
    } catch (error) {
        console.error(
            "AutoMod message error:",
            error
        );
    }
});

// ======================================================
// ERRORS
// ======================================================

client.on("error", error => {
    console.error(
        "Discord Client Error:",
        error
    );
});

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