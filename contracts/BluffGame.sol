// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title BLUFF — Dark Box Game
/// @notice Two-player, score-only commit-reveal game. This contract never holds or transfers value.
contract BluffGame {
    enum SecretChoice { TREASURE, TRAP }
    enum Action { TRUST, EXPOSE }
    enum Status { NONE, WAITING_FOR_ACTION, WAITING_FOR_REVEAL, FINISHED }
    enum FinishReason { NONE, REVEALED, CHALLENGER_TIMEOUT, BLUFFER_TIMEOUT }

    struct Game {
        address bluffer;
        address challenger;
        bytes32 commitment;
        uint64 actionDeadline;
        uint64 revealDeadline;
        Status status;
        Action action;
        SecretChoice revealedSecret;
        FinishReason finishReason;
        uint8 blufferScore;
        uint8 challengerScore;
    }

    uint64 public immutable actionWindow;
    uint64 public immutable revealWindow;
    uint256 public nextGameId;
    mapping(uint256 gameId => Game game) private games;

    error ZeroAddress();
    error InvalidWindow();
    error EmptyCommitment();
    error SelfChallenge();
    error UnexpectedGameId(uint256 expected, uint256 actual);
    error GameNotFound(uint256 gameId);
    error NotBluffer();
    error NotChallenger();
    error InvalidStatus(Status expected, Status actual);
    error InvalidAction();
    error InvalidSecretChoice();
    error DeadlinePassed(uint256 deadline);
    error DeadlineNotPassed(uint256 deadline);
    error CommitmentMismatch();

    event GameCreated(
        uint256 indexed gameId,
        address indexed bluffer,
        address indexed challenger,
        bytes32 commitment,
        uint256 actionDeadline
    );
    event ActionChosen(uint256 indexed gameId, address indexed challenger, Action action, uint256 revealDeadline);
    event GameRevealed(uint256 indexed gameId, SecretChoice secretChoice, Action action);
    event GameFinished(
        uint256 indexed gameId,
        uint8 blufferScore,
        uint8 challengerScore,
        FinishReason reason
    );
    event GameTimedOut(uint256 indexed gameId, FinishReason reason);

    constructor(uint64 actionWindow_, uint64 revealWindow_) {
        if (actionWindow_ == 0 || revealWindow_ == 0) revert InvalidWindow();
        actionWindow = actionWindow_;
        revealWindow = revealWindow_;
    }

    function createGame(uint256 expectedGameId, address challenger, bytes32 commitment)
        external
        returns (uint256 gameId)
    {
        if (challenger == address(0)) revert ZeroAddress();
        if (challenger == msg.sender) revert SelfChallenge();
        if (commitment == bytes32(0)) revert EmptyCommitment();
        if (expectedGameId != nextGameId) revert UnexpectedGameId(expectedGameId, nextGameId);

        gameId = nextGameId++;
        uint64 deadline = uint64(block.timestamp) + actionWindow;
        Game storage game = games[gameId];
        game.bluffer = msg.sender;
        game.challenger = challenger;
        game.commitment = commitment;
        game.actionDeadline = deadline;
        game.status = Status.WAITING_FOR_ACTION;

        emit GameCreated(gameId, msg.sender, challenger, commitment, deadline);
    }

    function chooseAction(uint256 gameId, uint8 action) external {
        Game storage game = _game(gameId);
        if (msg.sender != game.challenger) revert NotChallenger();
        if (game.status != Status.WAITING_FOR_ACTION) {
            revert InvalidStatus(Status.WAITING_FOR_ACTION, game.status);
        }
        if (block.timestamp > game.actionDeadline) revert DeadlinePassed(game.actionDeadline);
        if (action > uint8(Action.EXPOSE)) revert InvalidAction();

        uint64 deadline = uint64(block.timestamp) + revealWindow;
        game.action = Action(action);
        game.revealDeadline = deadline;
        game.status = Status.WAITING_FOR_REVEAL;
        emit ActionChosen(gameId, msg.sender, Action(action), deadline);
    }

    function reveal(uint256 gameId, uint8 secretChoice, bytes32 salt) external {
        Game storage game = _game(gameId);
        if (msg.sender != game.bluffer) revert NotBluffer();
        if (game.status != Status.WAITING_FOR_REVEAL) {
            revert InvalidStatus(Status.WAITING_FOR_REVEAL, game.status);
        }
        if (block.timestamp > game.revealDeadline) revert DeadlinePassed(game.revealDeadline);
        if (secretChoice > uint8(SecretChoice.TRAP)) revert InvalidSecretChoice();

        bytes32 actual = keccak256(
            abi.encode(gameId, block.chainid, address(this), game.bluffer, secretChoice, salt)
        );
        if (actual != game.commitment) revert CommitmentMismatch();

        SecretChoice secret = SecretChoice(secretChoice);
        game.revealedSecret = secret;
        game.finishReason = FinishReason.REVEALED;
        _score(game, secret, game.action);
        game.status = Status.FINISHED;

        emit GameRevealed(gameId, secret, game.action);
        emit GameFinished(gameId, game.blufferScore, game.challengerScore, FinishReason.REVEALED);
    }

    function settleTimeout(uint256 gameId) external {
        Game storage game = _game(gameId);
        FinishReason reason;

        if (game.status == Status.WAITING_FOR_ACTION) {
            if (block.timestamp <= game.actionDeadline) revert DeadlineNotPassed(game.actionDeadline);
            reason = FinishReason.CHALLENGER_TIMEOUT;
            // A no-action timeout is only a forfeit marker: no game points are awarded.
        } else if (game.status == Status.WAITING_FOR_REVEAL) {
            if (block.timestamp <= game.revealDeadline) revert DeadlineNotPassed(game.revealDeadline);
            reason = FinishReason.BLUFFER_TIMEOUT;
            game.challengerScore = 4;
        } else {
            revert InvalidStatus(Status.WAITING_FOR_ACTION, game.status);
        }

        game.finishReason = reason;
        game.status = Status.FINISHED;
        emit GameTimedOut(gameId, reason);
        emit GameFinished(gameId, game.blufferScore, game.challengerScore, reason);
    }

    function getGame(uint256 gameId) external view returns (Game memory) {
        return _game(gameId);
    }

    function getGameResult(uint256 gameId)
        external
        view
        returns (uint8 blufferScore, uint8 challengerScore, FinishReason reason)
    {
        Game storage game = _game(gameId);
        if (game.status != Status.FINISHED) revert InvalidStatus(Status.FINISHED, game.status);
        return (game.blufferScore, game.challengerScore, game.finishReason);
    }

    function computeCommitment(
        uint256 gameId,
        address bluffer,
        uint8 secretChoice,
        bytes32 salt
    ) external view returns (bytes32) {
        if (secretChoice > uint8(SecretChoice.TRAP)) revert InvalidSecretChoice();
        return keccak256(abi.encode(gameId, block.chainid, address(this), bluffer, secretChoice, salt));
    }

    function _game(uint256 gameId) private view returns (Game storage game) {
        game = games[gameId];
        if (game.status == Status.NONE) revert GameNotFound(gameId);
    }

    function _score(Game storage game, SecretChoice secret, Action action) private {
        if (secret == SecretChoice.TREASURE && action == Action.TRUST) {
            game.blufferScore = 2;
            game.challengerScore = 2;
        } else if (secret == SecretChoice.TREASURE && action == Action.EXPOSE) {
            game.blufferScore = 3;
        } else if (secret == SecretChoice.TRAP && action == Action.TRUST) {
            game.blufferScore = 4;
        } else {
            game.challengerScore = 4;
        }
    }
}
