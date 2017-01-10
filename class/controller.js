//TODO: set category on game class on game init.


const Game = require(APPLICATION_PATH + '/class/game'),
    Player = require(APPLICATION_PATH + '/class/player');/*,
    Question = require(APPLICATION_PATH + '/class/question');*/

module.exports = function (io, sockets) {
    let _this = this;
    this.game = new Game();
    this.players = [];
    //this.question = new Question();
    this.players.next = function () {
        if (this.currentI + 1 == this.length)
            return this[0];
        return this[++this.currentI];
    };
    this.players.current = function () {
        return this[this.currentI];
    };
    this.players.forEach = function (callback) {
        for (let i = 0; i < this.length; i++)
            callback(this[i], i, this);
    };


    this.players.currentI = 0;
    this.room_name = 'ROOM_' + (++ROOM_COUNT);
    this.room = io.sockets.in(this.room_name);

    sockets.forEach(function (socket) {
        _this.players.push(new Player(socket));
        socket.join(_this.room_name);
    });

    console.log('new room (' + this.room_name + ')');

    this.room.emit('login');

    this.on = function (event, callback) {
        this.players.forEach(function (player) {
            player.getSocket().on(event, function (data) {
                callback(data, player);
            });
        });
    };

    this.on('login', function (data, player) {

        console.log(data);
        if (!VALIDATOR.isColorValid(data.color) || !VALIDATOR.isLanguageValid(data.lang) || !VALIDATOR.isCategoryValid(data.category)) {
            throw "Invalid data (color, category or language) from client.";
        }

        player.lang = data.lang;
        player.name = data.name;
        // TODO: The last player changes the category for all players in this game. Logic bug.
        _this.game.setCategory(data.category);

        // Check if player color is still available.
        if (_this.game.isColorAvailable(data.color)) {
            player.color = data.color;
            _this.players.forEach(function (player) {
                player.emit('available-colors', _this.game.getAllAvailableColors());
            });
            player.isReady = true;
            _this.checkReady();
        }
    });

    this.checkReady = function () {
        for (let i = 0; i < _this.players.length; i++) {
            if (!this.players[i].isReady)
                return false;
        }

        _this.players.forEach(function (player) {
            player.emit('map', _this.game.getField());
        });

        console.log('game start (' + _this.room_name + ')');
        _this.gameRound();
    };

    this.gameRound = function () {
        this.players.current().emit('roll-the-dice');
    };

    this.on('roll-the-dice', function (data, player) {
        console.log(player);
        if (player.getId() == _this.players.current().id) {
            var dice = RANDOM_NUMBER.getRandomDiceValue();
            player.emit('dice-result', dice);
            _this.process(dice);
        }
    });

    this.gameOver = function () {
        _this.players.forEach(function (player) {
            player.emit('game-over', _this.players.current().getId());
        });
    };

    this.handleQuestion = function (resolve, reject) {

        // TODO: TEST
        var difficulty;

        //TODO: Check: get difficulty from frontend
        _this.players.current().once('set-difficulty', function (data) {

            if (data.isNumber && (data == 1 || data == 3 || data == 5)) {
                difficulty = data;
            }
            else {
                throw 'Invalid difficulty value from client.';
            }

            // Get question and answers from database.
            var questionObject = _this.getQuestion(difficulty);
            var correctAnswerId = questionObject[0].correctAnswer;

            // Send question and answers to client. Also send the image for this question.
            _this.players.current().emit('question', {
                question: questionObject[1],
                answers: questionObject[2],
                questionImage: questionObject[0].img
            });

            // Get and process question answer from client.
            _this.players.current().once('answer', function (answerId) {

                // Check for correct answer.
                if (answerId.isNumber && answerId === correctAnswerId) {
                    _this.players.current().addPosition(difficulty);
                } else {
                    _this.players.current().subPosition(difficulty);
                }
                resolve();
            });
        });

        // No answer is a wrong answer.
        setTimeout(function () {
            _this.players.current().subPosition(difficulty);
            resolve();
        }, 20000);  // 20 seconds.
    };

    // Gets a random question with the appropriate answers from database.
    this.getQuestion = function (difficulty) {
        var gameCategory = _this.game.getCategory();
        var userLanguage = _this.players.current().lang;

        // TODO: Testing this call.
        return _this.question.getQuestionWithAnswers(gameCategory, difficulty, userLanguage).then(function (result) {
            console.log("Result from database call: " + result);
        });
    };

    this.process = function (dice) {
        var pos = this.players.current().addPosition(dice);

        // Check if player has finished the game.
        if (_this.game.getField().length > pos - 1) {
            _this.gameOver();
            return;
            // Check if player is behind the start field.
        } else if (pos < 0) {
            // Move to start.
            _this.players.current().setPosition(0);
        }

        var step = _this.game.getField()[pos];

        var promise = new Promise(function (resolve, reject) {
            switch (step.type) {
                case 'default':
                    resolve();
                    break;
                case 'question':
                    _this.handleQuestion(resolve, reject);
                    break;
                case 'jump':
                    _this.players.current().setPosition(step.jumpDestinationId);
                    resolve();
                    break;
                default:
                    throw 'unknown field type';
            }
        });

        promise.then(function () {
            var positions = [];
            _this.players.forEach(function (player) {
                positions[player.getId()] = player.getPosition();
            });
            _this.players.forEach(function (player) {
                player.emit('player-position', positions);
            });
            //_this.room.emit('player-position', positions);
            _this.players.next();
            _this.gameRound();
        }).error(function () {
            throw 'unknown error';
        });
    };

};