//TODO: set category on game class on game init.

const EventEmitter = require('events'),
    Game = require(APPLICATION_PATH + '/class/game'),
    Player = require(APPLICATION_PATH + '/class/player'),
    Question = require(APPLICATION_PATH + '/class/question'),
    Validator = require('../functions/validator'),
    RandomNumber = require('../functions/randomNumber'),
    {log} = require('../functions/functions'),
    PlayerList = require('./playerList');


class Controller extends EventEmitter {
    constructor(io, id) {
        super();

        this.id = id;
        this.io = io;
        this.game = new Game();
        this.question = new Question();
        this.players = new PlayerList();
        this.room_name = 'ROOM_' + this.id;
        this.room = this.io.sockets.in(this.room_name);

        log('new room (' + this.room_name + ')', 'green');

        this.room.emit('login');
    }

    addPlayer() {
        for (let key in arguments) {
            if (!arguments.hasOwnProperty(key))
                continue;

            let player = new Player(arguments[key]);
            player.getSocket().join(this.room_name);
            this.players.add(player);

            //set socket events
            player.getSocket().on('login', (data) => {
                //todo remove language validator
                if (!Validator.isColorValid(data.color)
                    || !Validator.isCategoryValid(data.category) || !Validator.isStringHarmless(data.name)) {
                    throw "Invalid data (color, category or name) from client.";
                }

                player.lang = data.lang;
                player.name = data.name;
                // TODO: Logic bug: The last player changes the category for all players in this game.
                this.game.setCategory(data.category);

                // Check if player color is still available.
                if (this.game.isColorAvailable(data.color)) {
                    player.color = data.color;

                    this.sendAvailableColorsToAllClients();
                    player.isReady = true;
                    this.checkReady();
                }
            }).on('disconnect', () => {
                this.players.remove(player.getId());
                this.emit('disconnect');
            });
        }
    }

    broadcast(event, data) {
        this.io.sockets.in(this.room_name).emit(event, data);
    }

    // Sends all available colors to all players (clients).
    sendAvailableColorsToAllClients() {
        this.broadcast('room', this.room_name);
        this.broadcast('available-colors', this.game.getAllAvailableColors());
    }

    // Checks if all players within a game are ready.
    // If so, send all players the game field (map) and trigger first game round.
    checkReady() {
        for (let i = 0; i < this.players.size(); i++) {
            if (!this.players.index(i).isReady)
                return false;
        }

        this.broadcast('map', this.game.getField());

        log('game start (' + this.room_name + ')');
        this.gameRound();
    }


    // The current player will be notified to role the dice.
    gameRound() {
        this.players.current().emit('roll-the-dice');

        // Handles the dice role action.
        this.players.current().getSocket().once('roll-the-dice', () => {
            const dice = RandomNumber.getRandomDiceValue();
            this.players.current().getSocket().emit('dice-result', dice);
            this.process(dice);
        });
    }

    // Handles the end of game action. Sends the id of the winner player.
    gameOver() {
        this.broadcast('game-over', this.players.current().getId());
    }

    // Handles the question logic.
    handleQuestion(resolve, reject) {

        // TODO: TEST
        let difficulty;

        //TODO: Check: Get difficulty from frontend.
        // Get player difficulty value for a question.
        this.players.current().once('set-difficulty', (data) => {

            if (data.isNumber && (data == 1 || data == 3 || data == 5)) {
                difficulty = data;
            }
            else {
                throw 'Invalid difficulty value from client.';
            }

            // Get a question with its appropriate answers from database.
            let questionObject = this.getQuestion(difficulty);
            let correctAnswerId = questionObject[0].correctAnswer;

            // Send question and answers to client. Also send the image for this question.
            this.players.current().emit('question', {
                question: questionObject[1],
                answers: questionObject[2],
                questionImage: questionObject[0].img
            });

            // Get and process question answer from client.
            this.players.current().once('answer', (answerId) => {

                // Check for correct answer and move player appropriate.
                if (answerId.isNumber && answerId === correctAnswerId) {
                    this.players.current().addPosition(difficulty);
                } else {
                    this.players.current().subPosition(difficulty);
                }
                resolve();
            });
        });

        // No answer is a wrong answer.
        setTimeout(() => {
            this.players.current().subPosition(difficulty);
            resolve();
        }, 20000);  // 20 seconds.
    }

    // Gets a random question with the appropriate answers from database.
    getQuestion(difficulty) {
        const gameCategory = this.game.getCategory();
        const userLanguage = this.players.current().lang;

        // TODO: Testing this call.
        return this.question.getQuestionWithAnswers(gameCategory, difficulty, userLanguage).then((result) => {
            console.log("Result from database call: " + result);
        });
    }

    // Moves the player to a new position on the playing field (map).
    process(dice) {
        let pos = this.players.current().addPosition(dice);

        // Check if the player has finished the game.
        if (this.game.getField().length < pos - 1) {
            this.gameOver();
            return;
            // Check if the player is behind the start field.
        } else if (pos < 0) {
            // Move to start.
            this.players.current().setPosition(0);
        }

        let step = this.game.getField()[pos];

        // Check the new position of the player and deals with special fields.
        const promise = new Promise((resolve, reject) => {
            switch (step.type) {
                case 'default':
                case 'question':
                    resolve();
                    break;
                //todo question fields frontend
                /*case 'question':
                 this.handleQuestion(resolve, reject);
                 break;*/
                case 'jump':
                    this.players.current().setPosition(step.jumpDestinationId);
                    resolve();
                    break;
                default:
                    reject('unknown field type');
            }
        });

        // Notify all players with the new position of all players.
        promise.then(() => {
            const positions = [];

            this.players.each((player) => {
                positions[player.getId()] = player.getPosition();
            });

            this.broadcast('player-position', positions);

            // It's the next players turn.
            this.players.next();
            this.gameRound();
        }).catch(() => {
            throw 'unknown error';
        });
    }

    getId() {
        return this.id;
    }

}

module.exports = Controller;