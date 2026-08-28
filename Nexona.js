const {
    Client,
    GatewayIntentBits,
    REST,
    Routes
} = require("discord.js");

require("dotenv").config();

const automod = require("./automod");
const automod2 = require("./automod2");
const softban = require("./softban");

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
// INSTALL SYSTEMS
// ======================================================

// AutoMod
if (automod.install) {
    automod.install(client);
}

// Softban
if (softban.install) {
    softban.install(client);
}

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
        // ALL SLASH COMMANDS
        // ==================================================

        const allCommands = [
            ...(automod.commands || []),
            ...(automod2.commands || []),
            ...(softban.commands || [])
        ];

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

        // Show registered Softban commands
        const softbanCommandNames =
            (softban.commands || []).map(
                command => `/${command.name}`
            );

        if (softbanCommandNames.length > 0) {
            console.log(
                `Softban commands: ${softbanCommandNames.join(", ")}`
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

            // ----------------------------------------------
            // Chat Input Commands
            // ----------------------------------------------

            if (interaction.isChatInputCommand()) {

                let handled = false;

                // ------------------------------------------
                // AutoMod
                // ------------------------------------------

                if (automod.handleCommand) {

                    const result =
                        await automod.handleCommand(
                            interaction
                        );

                    if (result === true) {
                        handled = true;
                    }
                }

                // ------------------------------------------
                // AutoMod 2
                // ------------------------------------------

                if (
                    !handled &&
                    automod2.handleInteraction
                ) {

                    await automod2.handleInteraction(
                        interaction
                    );

                }

                // ------------------------------------------
                // Softban
                //
                // Softban already has its own interaction
                // listener through softban.install(client).
                //
                // We do NOT handle it here again because
                // that would cause duplicate replies.
                // ------------------------------------------

                return;
            }

            // ----------------------------------------------
            // Modals / Buttons / Select Menus
            // ----------------------------------------------

            if (
                interaction.isModalSubmit() ||
                interaction.isButton() ||
                interaction.isStringSelectMenu() ||
                interaction.isRoleSelectMenu() ||
                interaction.isChannelSelectMenu() ||
                interaction.isUserSelectMenu()
            ) {

                if (automod.handleInteraction) {

                    await automod.handleInteraction(
                        interaction
                    );

                }

                if (
                    !interaction.replied &&
                    !interaction.deferred &&
                    automod2.handleInteraction
                ) {

                    await automod2.handleInteraction(
                        interaction
                    );

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
// MESSAGES
// ======================================================

client.on(
    "messageCreate",
    async message => {

        try {

            // Existing AutoMod
            if (automod.handleMessage) {

                await automod.handleMessage(
                    message
                );

            }

            // New AutoMod 2
            if (automod2.handleMessage) {

                await automod2.handleMessage(
                    message
                );

            }

        } catch (error) {

            console.error(
                "AutoMod message error:",
                error
            );

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