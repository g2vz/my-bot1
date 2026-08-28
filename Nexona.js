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

if (automod.install) {
    automod.install(client);
}

if (softban.install) {
    softban.install(client);
}

// ======================================================
// SOFTBAN COMMAND NAMES
// ======================================================

const SOFTBAN_COMMANDS = [
    "softban",
    "softban-add",
    "softban-remove"
];

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

        console.log(
            "Softban commands registered:"
        );

        for (
            const cmdData
            of commandData.filter(cmd => SOFTBAN_COMMANDS.includes(cmd.name))
        ) {
            console.log(
                `  /${cmdData.name}`
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
            // SOFTBAN COMMANDS
            // ==================================================
            //
            // softban.js has its own interaction handler.
            // Do NOT process these commands here.
            //
            // This prevents AutoMod / AutoMod2 from interfering
            // with Softban.
            // ==================================================

            if (
                interaction.isChatInputCommand() &&
                SOFTBAN_COMMANDS.includes(
                    interaction.commandName
                )
            ) {
                return;
            }


            // ==================================================
            // CHAT INPUT COMMANDS
            // ==================================================

            if (
                interaction.isChatInputCommand()
            ) {

                let handled = false;


                // ----------------------------------------------
                // AutoMod
                // ----------------------------------------------

                if (
                    automod.handleCommand
                ) {

                    const result =
                        await automod.handleCommand(
                            interaction
                        );

                    if (
                        result === true
                    ) {
                        handled = true;
                    }
                }


                // ----------------------------------------------
                // AutoMod 2
                // ----------------------------------------------

                if (
                    !handled &&
                    automod2.handleInteraction
                ) {

                    await automod2.handleInteraction(
                        interaction
                    );
                }

                return;
            }


            // ==================================================
            // MODALS / BUTTONS / SELECT MENUS
            // ==================================================

            if (
                interaction.isModalSubmit() ||
                interaction.isButton() ||
                interaction.isStringSelectMenu() ||
                interaction.isRoleSelectMenu() ||
                interaction.isChannelSelectMenu() ||
                interaction.isUserSelectMenu()
            ) {

                if (
                    automod.handleInteraction
                ) {

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
            if (
                automod.handleMessage
            ) {

                await automod.handleMessage(
                    message
                );
            }


            // AutoMod 2
            if (
                automod2.handleMessage
            ) {

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

