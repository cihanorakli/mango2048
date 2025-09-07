// CHANGE: Full upgrade of game logic with fruits, animations, hint arrow, game over, and responsive positioning via CSS variables
document.addEventListener('DOMContentLoaded', () => {
  const grid = document.querySelector('.grid');
  const scoreDisplay = document.getElementById('score');
  const bestScoreDisplay = document.getElementById('best-score');
  const newGameBtn = document.getElementById('new-game');
  const restartGameBtn = document.getElementById('restart-game');
  const gameOverElement = document.getElementById('game-over');
  const gameContainer = document.querySelector('.game-container');
  const hintArrow = document.getElementById('hint-arrow');

  // CHANGE: Read CSS variables so JS stays in sync with layout
  function getMetrics() {
    const styles = getComputedStyle(document.documentElement);
    const tile = parseInt(styles.getPropertyValue('--tile-size')) || 80;
    const gap = parseInt(styles.getPropertyValue('--tile-gap')) || 12;
    return { TILE: tile, GAP: gap, SIZE: 4 };
  }

  // CHANGE: Fruit mapping (no numbers shown)
  const fruitMap = {
    2: '🍎',
    4: '🍐',
    8: '🍓',
    16: '🍍',
    32: '🍇',
    64: '🍌',
    128: '🍑',
    256: '🥝',
    512: '🍒',
    1024: '🍉',
    2048: '🥭'
  };

  // CHANGE: Configurable spawn probabilities (must sum to 1)
  const SPAWN_PROB = {
    2: 0.8,   // Apple
    4: 0.15,  // Pear
    8: 0.05   // Strawberry
  };

  let board = [];
  let score = 0;
  let bestScore = parseInt(localStorage.getItem('bestScore') || '0', 10);
  let gameOver = false;
  // CHANGE: Invalid move tracking for shake + hint
  let invalidMoveCount = 0;
  let animating = false; // prevent input during animations

  bestScoreDisplay.textContent = bestScore;

  // CHANGE: Utility to compute pixel position inside board using CSS vars
  function posToPx(row, col) {
    const { TILE, GAP } = getMetrics();
    // CHANGE: Position relative to grid's padding box (no extra leading GAP)
    // Ensures last column/row fits exactly within board-size = 4*T + 3*GAP
    return {
      top: row * (TILE + GAP),
      left: col * (TILE + GAP)
    };
  }

  // CHANGE: DOM helpers for tiles. We rebuild after each move but animate transitions first
  function clearTiles() {
    document.querySelectorAll('.tile').forEach(el => el.remove());
  }

  function createTileEl(row, col, value) {
    const el = document.createElement('div');
    el.className = `tile tile-${value}`;
    el.dataset.pos = `${row}-${col}`;
    el.textContent = fruitMap[value] || '';
    const { top, left } = posToPx(row, col);
    el.style.top = `${top}px`;
    el.style.left = `${left}px`;
    grid.appendChild(el);
    return el;
  }

  function renderBoard() {
    clearTiles();
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const v = board[r][c];
        if (v) createTileEl(r, c, v);
      }
    }
  }

  // CHANGE: Init/reset
  function initGame() {
    board = Array.from({ length: 4 }, () => Array(4).fill(0));
    score = 0;
    scoreDisplay.textContent = '0';
    gameOver = false;
    gameOverElement.style.display = 'none';
    invalidMoveCount = 0;
    hideHint();
    clearTiles();
    addRandomTile();
    addRandomTile();
    renderBoard();
  }

  // CHANGE: Add random tile
  function addRandomTile() {
    const empties = [];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) if (board[r][c] === 0) empties.push([r, c]);
    }
    if (!empties.length) return false;
    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    // CHANGE: Sample value using SPAWN_PROB
    const roll = Math.random();
    let acc = 0;
    let chosen = 2;
    for (const [valStr, p] of Object.entries(SPAWN_PROB)) {
      acc += p;
      if (roll <= acc) { chosen = parseInt(valStr, 10); break; }
    }
    board[r][c] = chosen;
    return true;
  }

  // CHANGE: Check if any moves are possible
  function noMovesAvailable() {
    // Empty cell exists
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!board[r][c]) return false;
    // Adjacent merges
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        const v = board[r][c];
        if (r < 3 && board[r + 1][c] === v) return false;
        if (c < 3 && board[r][c + 1] === v) return false;
      }
    }
    return true;
  }

  // CHANGE: Slide and merge a 1D array to the left; returns actions for animation
  function slideMergeLine(line) {
    const size = 4;
    let nonZero = [];
    for (let i = 0; i < size; i++) if (line[i] !== 0) nonZero.push({ idx: i, val: line[i] });

    const actions = []; // {from, to, merged}
    const out = Array(size).fill(0);
    let outIdx = 0;
    let scoreGain = 0;
    let i = 0;
    while (i < nonZero.length) {
      if (i + 1 < nonZero.length && nonZero[i].val === nonZero[i + 1].val) {
        // merge
        const mergedVal = nonZero[i].val * 2;
        out[outIdx] = mergedVal;
        scoreGain += mergedVal;
        // First moves to outIdx, second also moves and is absorbed
        actions.push({ from: nonZero[i].idx, to: outIdx, merged: true });
        actions.push({ from: nonZero[i + 1].idx, to: outIdx, merged: true, absorbed: true });
        outIdx++;
        i += 2;
      } else {
        out[outIdx] = nonZero[i].val;
        actions.push({ from: nonZero[i].idx, to: outIdx, merged: false });
        outIdx++;
        i++;
      }
    }
    // Fill rest with zeros
    while (outIdx < size) outIdx++;

    const moved = actions.some(a => a.from !== a.to);
    return { line: out, actions, moved, scoreGain };
  }

  // CHANGE: Rotate helpers to reuse left-merge logic
  function rotateBoardTimes(mat, times) {
    let b = mat.map(row => row.slice());
    for (let t = 0; t < times; t++) {
      const nb = Array.from({ length: 4 }, () => Array(4).fill(0));
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) nb[c][3 - r] = b[r][c];
      b = nb;
    }
    return b;
  }
  function rotatePointTimes(r, c, times) {
    let R = r, C = c;
    for (let t = 0; t < times; t++) {
      const nr = C;
      const nc = 3 - R;
      R = nr; C = nc;
    }
    return [R, C];
  }

  // CHANGE: Perform a move with animation
  async function handleMove(dir) {
    if (gameOver || animating) return;

    // 0:left, 1:up, 2:right, 3:down mapped via rotations so we always operate left
    // CHANGE: Corrected rotation mapping so Up moves up and Down moves down.
    // We rotate clockwise 'rot' times, then perform a left-merge.
    // Verified mapping:
    //  - left  => rot=0 (no rotation)
    //  - up    => rot=3 (rotate 270° CW)   → left on rotated = up on original
    //  - right => rot=2 (rotate 180° CW)
    //  - down  => rot=1 (rotate 90°  CW)
    // Quick mental test:
    //  Place a single tile at top row, moving Up should keep it at top; moving Down should push it to bottom.
    const dirMap = { left: 0, up: 3, right: 2, down: 1 };
    const rot = dirMap[dir] || 0;

    const rotated = rotateBoardTimes(board, rot);
    let moved = false;
    let totalGain = 0;
    const allActions = []; // will store actions with absolute coords
    const mergedTargets = new Set();

    const newRot = Array.from({ length: 4 }, () => Array(4).fill(0));
    for (let r = 0; r < 4; r++) {
      const { line, actions, moved: rowMoved, scoreGain } = slideMergeLine(rotated[r]);
      newRot[r] = line;
      totalGain += scoreGain;
      moved = moved || rowMoved;
      // Translate actions to absolute positions
      actions.forEach(a => {
        const fromAbs = rotatePointTimes(r, a.from, (4 - rot) % 4); // from (row=r, col=a.from)
        const toAbs = rotatePointTimes(r, a.to, (4 - rot) % 4);
        allActions.push({ from: { r: fromAbs[0], c: fromAbs[1] }, to: { r: toAbs[0], c: toAbs[1] }, merged: a.merged, absorbed: !!a.absorbed });
        if (a.merged && !a.absorbed) mergedTargets.add(`${toAbs[0]}-${toAbs[1]}`);
      });
    }

    if (!moved) {
      // CHANGE: Shake animation on invalid move
      invalidMoveCount++;
      gameContainer.classList.remove('board-shake');
      void gameContainer.offsetWidth; // reflow to restart animation
      gameContainer.classList.add('board-shake');
      maybeShowHint();
      return;
    }

    // Valid move
    invalidMoveCount = 0;
    hideHint();
    animating = true;

    // Update score
    if (totalGain) {
      score += totalGain;
      scoreDisplay.textContent = String(score);
      if (score > bestScore) {
        bestScore = score;
        bestScoreDisplay.textContent = String(bestScore);
        localStorage.setItem('bestScore', String(bestScore));
      }
    }

    // Animate movements first based on current DOM, then finalize board
    const movementPromises = [];
    const movedFrom = new Set();
    allActions.forEach(({ from, to }) => {
      if (from.r === to.r && from.c === to.c) return;
      movedFrom.add(`${from.r}-${from.c}`);
      const el = document.querySelector(`.tile[data-pos="${from.r}-${from.c}"]`);
      if (el) {
        const { top, left } = posToPx(to.r, to.c);
        el.style.top = `${top}px`;
        el.style.left = `${left}px`;
        el.dataset.pos = `${to.r}-${to.c}`;
        movementPromises.push(new Promise(res => {
          el.addEventListener('transitionend', function handler() {
            el.removeEventListener('transitionend', handler);
            res();
          });
        }));
      }
    });

    await Promise.all(movementPromises);

    // Finalize board state: rotate back and set board
    const finalBoard = rotateBoardTimes(newRot, (4 - rot) % 4);
    board = finalBoard;

    // Add new tile before rendering so it can also appear
    addRandomTile();

    // Re-render DOM fresh
    renderBoard();

    // Apply merge bounce on targets
    mergedTargets.forEach(key => {
      const el = document.querySelector(`.tile[data-pos="${key}"]`);
      if (el) {
        el.classList.remove('tile-merge');
        void el.offsetWidth; // reflow
        el.classList.add('tile-merge');
      }
    });

    animating = false;

    // Check game over
    if (noMovesAvailable()) {
      gameOver = true;
      gameOverElement.style.display = 'block';
    }
  }

  // CHANGE: Hint arrow logic
  function maybeShowHint() {
    if (invalidMoveCount < 2) return; // show after 2 invalid attempts
    const best = computeBestMove();
    if (!best) return;
    const dir = best.dir;
    hintArrow.style.display = 'flex';
    const icon = hintArrow.querySelector('.arrow-icon');
    const arrows = { left: '←', up: '↑', right: '→', down: '↓' };
    icon.textContent = arrows[dir];
  }
  function hideHint() {
    hintArrow.style.display = 'none';
  }

  // CHANGE: Simple heuristic to choose best move
  function computeBestMove() {
    const dirs = ['left', 'up', 'right', 'down'];
    let best = null;
    dirs.forEach(dir => {
      const rot = { left: 0, up: 1, right: 2, down: 3 }[dir];
      const rotated = rotateBoardTimes(board, rot);
      let scoreGain = 0;
      let moved = false;
      let temp = Array.from({ length: 4 }, (_, r) => rotated[r].slice());
      for (let r = 0; r < 4; r++) {
        const res = slideMergeLine(temp[r]);
        scoreGain += res.scoreGain;
        moved = moved || res.moved;
        temp[r] = res.line;
      }
      if (!moved) return;
      // Count free spaces
      let free = 0;
      const unrot = rotateBoardTimes(temp, (4 - rot) % 4);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!unrot[r][c]) free++;
      const heuristic = scoreGain * 100 + free; // prioritize merges
      if (!best || heuristic > best.h) best = { dir, h: heuristic };
    });
    return best;
  }

  // CHANGE: Input handlers (arrows, WASD)
  document.addEventListener('keydown', (e) => {
    const map = {
      ArrowLeft: 'left', ArrowUp: 'up', ArrowRight: 'right', ArrowDown: 'down',
      a: 'left', A: 'left', w: 'up', W: 'up', d: 'right', D: 'right', s: 'down', S: 'down'
    };
    const dir = map[e.key];
    if (dir) {
      e.preventDefault();
      handleMove(dir);
    }
  });

  // CHANGE: Touch swipe with threshold to avoid ghost swipes
  let startX = 0, startY = 0;
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    const TH = 20; // threshold
    if (!startX && !startY) return;
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const dx = endX - startX;
    const dy = endY - startY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < TH) return;
    if (Math.abs(dx) > Math.abs(dy)) {
      handleMove(dx > 0 ? 'right' : 'left');
    } else {
      handleMove(dy > 0 ? 'down' : 'up');
    }
    startX = startY = 0;
  }, { passive: true });

  // CHANGE: Buttons
  newGameBtn.addEventListener('click', initGame);
  if (restartGameBtn) restartGameBtn.addEventListener('click', initGame);

  // CHANGE: Start the game
  initGame();
});
