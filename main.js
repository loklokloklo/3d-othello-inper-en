// ============================================================
// 3D Othello (4x4x4) — Human vs Human version (English site)
//
// Technologies: JavaScript / Three.js / Firebase Realtime Database
// Main features:
//   - 3D board rendering with camera control via OrbitControls
//   - Legal-move detection and stone flipping in 26 directions (3D)
//   - Legal-move markers, pass handling, and game-end detection
//   - Undo (the board is rebuilt by replaying the move history)
//   - Sends the finished game record to Firebase
// ============================================================

import * as THREE from './libs/three.module.js';
import { OrbitControls } from './libs/OrbitControls.js';
import { CSS2DRenderer } from './libs/CSS2DRenderer.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getDatabase, ref, push, set } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-database.js";

window.init = init;


// ============================================================
// Constants and global state
// ============================================================

// --- Three.js ---
let scene, camera, renderer, labelRenderer, controls;
let boardGroup;

// --- Game state ---
let board = [];                 // board[x][y][z] = 'black' | 'white' | null
let currentTurn = 'black';      // player to move
let firstPlayer = 'black';      // player who moved first
let gameStarted = 0;            // 2 while a game is in progress
let isPassPopupVisible = false; // true while the pass notification is shown

// --- Move records ---
const moveHistory = [];         // each entry: { player, move } or { player, pass }
const placedStones = new Set(); // keys "x,y,z" of occupied cells
let lastPlacedStone = null;     // [x, y, z] of the latest move (for highlighting)
let lastPlacedColor = null;     // color of the latest move

// --- Stone display ---
const stoneMap = new Map();     // key "x,y,z" -> stone Mesh
const stoneRadius = 0.3;

// --- Board dimensions ---
const size = 4;                 // cells per side
const spacing = 1.2;            // distance between cell centers

// The 26 neighboring directions in 3D
// (every combination of dx, dy, dz in {-1, 0, 1} except (0, 0, 0))
const directions = [];
for (let dx = -1; dx <= 1; dx++) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        directions.push([dx, dy, dz]);
      }
    }
  }
}

// --- Firebase (where game records are stored) ---
const firebaseConfig = {
  apiKey: "AIzaSyDpXdLFl05RGNS7sh0FEbFAtcM8aWgMVvg",
  authDomain: "d-othello.firebaseapp.com",
  projectId: "d-othello",
  storageBucket: "d-othello.firebasestorage.app",
  messagingSenderId: "895908988417",
  appId: "1:895908988417:web:6726542c927ad8d9c36200",
  databaseURL: "https://d-othello-default-rtdb.firebaseio.com/"
};

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);


// ============================================================
// Initialization
// ============================================================

function init() {
  // Scene, camera, renderer
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#ccffd0');

  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(10, 10, 10);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor('#ccf2ff');
  document.body.appendChild(renderer.domElement);

  // Renderer for HTML labels (also the element OrbitControls listens on)
  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  document.body.appendChild(labelRenderer.domElement);

  controls = new OrbitControls(camera, labelRenderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.target.set(3, 3, 3);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 5));

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 10);
  scene.add(directionalLight);

  scene.add(new THREE.AxesHelper(10));

  // Start with an empty board
  for (let x = 0; x < size; x++) {
    board[x] = [];
    for (let y = 0; y < size; y++) {
      board[x][y] = [];
      for (let z = 0; z < size; z++) {
        board[x][y][z] = null;
      }
    }
  }

  createBoardGrid();
  placeInitialStones();
  createAxes();

  updateStoneCountDisplay();
  animate();

  setupUndoButtons();
}

/** Builds the 4x4x4 grid (an invisible cube plus a wireframe for each cell). */
function createBoardGrid() {
  boardGroup = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);

  // The invisible cubes are used for click detection (raycasting)
  const transparentMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0
  });
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: 0xaaaaaa,
    wireframe: true
  });

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const boxGroup = new THREE.Group();
        boxGroup.add(new THREE.Mesh(geometry, transparentMaterial));
        boxGroup.add(new THREE.Mesh(geometry, wireframeMaterial));

        boxGroup.position.set(
          (x + 1.0) * spacing,
          (y + 1.0) * spacing,
          (z + 1.0) * spacing
        );

        boardGroup.add(boxGroup);
      }
    }
  }

  scene.add(boardGroup);
}

/** Places the initial stones (4 black and 4 white in the central 2x2x2). */
function placeInitialStones() {
  const BLACK = 0x000000;
  const WHITE = 0xffffff;

  const blackStones = [[1, 1, 1], [2, 2, 1], [2, 1, 2], [1, 2, 2]];
  const whiteStones = [[1, 2, 1], [2, 2, 2], [1, 1, 2], [2, 1, 1]];

  for (const [x, y, z] of blackStones) {
    createStone(x, y, z, BLACK);
    board[x][y][z] = 'black';
  }
  for (const [x, y, z] of whiteStones) {
    createStone(x, y, z, WHITE);
    board[x][y][z] = 'white';
  }
}

/** Draws the X (red), Y (green), and Z (blue) axis lines and their labels. */
function createAxes() {
  const axisLength = 5;

  const axisDefs = [
    { color: 0xff0000, end: new THREE.Vector3(axisLength, 0, 0) }, // X
    { color: 0x00ff00, end: new THREE.Vector3(0, axisLength, 0) }, // Y
    { color: 0x0000ff, end: new THREE.Vector3(0, 0, axisLength) }  // Z
  ];

  for (const { color, end } of axisDefs) {
    const material = new THREE.LineBasicMaterial({ color });
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      end
    ]);
    scene.add(new THREE.Line(geometry, material));
  }

  createAxisLabel('X', (4 + 0.5) * spacing, 0, 0);
  createAxisLabel('Y', 0, (4 + 0.5) * spacing, 0);
  createAxisLabel('Z', 0, 0, (4 + 0.5) * spacing);
}

/** Places a sprite showing an axis name (X / Y / Z) at (x, y, z). */
function createAxisLabel(text, x, y, z) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Transparent background, black text only
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'black';
  ctx.font = 'bold 72px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });

  const sprite = new THREE.Sprite(material);
  sprite.position.set(x, y, z);
  sprite.scale.set(1.2, 1.2, 1.2);
  scene.add(sprite);
}

/** Render loop. */
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

/** Registers the Undo buttons (the normal one and the one in the pass popup). */
function setupUndoButtons() {
  const undoButton = document.getElementById('undo-button');
  if (undoButton) {
    undoButton.addEventListener('click', () => {
      undoLastMove();
    });
  }

  const passUndoButton = document.getElementById('pass-undo-button');
  if (passUndoButton) {
    passUndoButton.addEventListener('click', () => {
      hidePassPopup();
      undoCore();
    });
  }
}


// ============================================================
// Starting a game (turn selection screen)
// ============================================================

const turnUI = document.getElementById('turn-selection');
const blackButton = document.getElementById('black-button');

if (blackButton && turnUI) {
  blackButton.addEventListener('click', () => {
    firstPlayer = 'black';
    currentTurn = 'black';
    turnUI.style.display = 'none';
    gameStarted = 2;
    showAllLegalMoves();
  });
}


// ============================================================
// Drawing stones
// ============================================================

/**
 * Creates a stone (sphere) and adds it to the scene.
 * @param {boolean} isLastPlaced If true, draws the stone in a reddish tint
 *   to mark it as the most recent move.
 */
function createStone(x, y, z, color, isLastPlaced = false) {
  let finalColor = color;

  if (isLastPlaced) {
    finalColor = (color === 0x000000) ? 0x4B0000 : 0xAA6666;
  }

  const geometry = new THREE.SphereGeometry(stoneRadius, 32, 32);
  const material = new THREE.MeshStandardMaterial({ color: finalColor });
  const stone = new THREE.Mesh(geometry, material);
  stone.position.set(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );
  scene.add(stone);

  stoneMap.set(`${x},${y},${z}`, stone);
}

/** Restores the previously highlighted stone to its normal color. */
function revertPreviousRedStone(color) {
  if (!lastPlacedStone) return;

  const [x, y, z] = lastPlacedStone;
  const mesh = stoneMap.get(`${x},${y},${z}`);
  if (mesh) {
    mesh.material.color.set(color);
  }
}

/** Removes the stone mesh at the given cell from the scene. */
function removeStoneAt(x, y, z) {
  const targetPosition = new THREE.Vector3(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );

  const toRemove = scene.children.find(obj =>
    obj instanceof THREE.Mesh &&
    obj.geometry.type === "SphereGeometry" &&
    obj.position.distanceTo(targetPosition) < 0.01
  );

  if (toRemove) {
    scene.remove(toRemove);
  }
}


// ============================================================
// Handling a move (click input)
// ============================================================

window.addEventListener('pointerdown', (event) => {
  if (gameStarted !== 2) return;
  if (isPassPopupVisible) return; // ignore board clicks while the pass popup is open

  // Use raycasting to find which cell was clicked
  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(boardGroup.children, true);
  if (intersects.length === 0) return;

  const point = intersects[0].object.parent.position;
  const x = Math.round(point.x / spacing) - 1;
  const y = Math.round(point.y / spacing) - 1;
  const z = Math.round(point.z / spacing) - 1;

  const key = `${x},${y},${z}`;
  if (placedStones.has(key)) return;
  if (!isLegalMove(board, x, y, z, currentTurn)) return;

  // Restore the previous highlight to its normal color, then place the new stone
  if (lastPlacedStone) {
    const prevColor = lastPlacedColor === 'black' ? 0x000000 : 0xffffff;
    revertPreviousRedStone(prevColor);
  }

  const color = currentTurn === 'black' ? 0x000000 : 0xffffff;
  createStone(x, y, z, color, true);

  board[x][y][z] = currentTurn;
  placedStones.add(key);
  lastPlacedStone = [x, y, z];
  lastPlacedColor = currentTurn;
  moveHistory.push({ player: currentTurn, move: [x, y, z] });

  // Flip before switching turns so the correct color is flipped
  flipStones(x, y, z, currentTurn);
  updateStoneCountDisplay();

  // Switch turns and show the next legal moves
  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  showAllLegalMoves();

  // If the next player has no legal move: pass, or end the game
  if (gameStarted === 2 && !hasAnyLegalMove(currentTurn)) {
    const otherPlayer = currentTurn === 'black' ? 'white' : 'black';
    if (!hasAnyLegalMove(otherPlayer)) {
      checkGameEnd();
    } else {
      showPassPopup();
    }
  }
});


// ============================================================
// Legal-move detection and display
// ============================================================

/**
 * Returns whether (x, y, z) is a legal move for currentTurn.
 * A move is legal if, in at least one of the 26 directions, one or more
 * opponent stones in a row are followed by one of the player's own stones.
 */
function isLegalMove(board, x, y, z, currentTurn) {
  if (board[x][y][z] !== null) {
    return false;
  }

  const opponent = currentTurn === 'black' ? 'white' : 'black';

  for (const [dx, dy, dz] of directions) {
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;
    let count = 0;

    // Walk along the line while opponent stones continue
    while (
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === opponent
    ) {
      nx += dx;
      ny += dy;
      nz += dz;
      count++;
    }

    // Legal if at least one opponent stone is capped by the player's own stone
    if (
      count > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === currentTurn
    ) {
      return true;
    }
  }

  return false;
}

/** Returns whether the given player has at least one legal move. */
function hasAnyLegalMove(player) {
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (isLegalMove(board, x, y, z, player)) return true;
      }
    }
  }
  return false;
}

/** Shows every legal move for the current player as a yellow sphere. */
function showAllLegalMoves() {
  clearLegalMoveMarkers();

  const legalMovesList = [];

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (isLegalMove(board, x, y, z, currentTurn)) {
          showLegalMoveIndicator(x, y, z);
          legalMovesList.push([x, y, z]);
        }
      }
    }
  }

  // Analysis log for developers (console output)
  logLegalMovesInfo(legalMovesList, currentTurn);
}

/** Removes all legal-move markers. */
function clearLegalMoveMarkers() {
  const toRemove = [];
  scene.traverse(obj => {
    if (obj.userData && obj.userData.isLegalMoveMarker) {
      toRemove.push(obj);
    }
  });
  toRemove.forEach(obj => scene.remove(obj));
}

/** Shows one legal-move marker (a small yellow sphere). */
function showLegalMoveIndicator(x, y, z) {
  const geometry = new THREE.SphereGeometry(stoneRadius * 0.6, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const sphere = new THREE.Mesh(geometry, material);

  sphere.userData.isLegalMoveMarker = true;
  sphere.name = 'legalMoveIndicator';
  sphere.position.set(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );

  scene.add(sphere);
}

/**
 * [Developer tool] For each legal move, logs to the console the total number
 * of empty cells adjacent to the opponent stones that the move would flip
 * (used for position analysis and AI development).
 *
 * - Adjacency uses the 26-neighborhood; cells outside the board are ignored
 * - The cell being played is not counted as empty
 * - An empty cell next to several flipped stones is counted only once
 *
 * Output format: "(x,y,z):N" for each legal move (coordinates are 1-based)
 */
function logLegalMovesInfo(legalMoves, player) {
  if (legalMoves.length === 0) return;

  const opponent = player === 'black' ? 'white' : 'black';
  const results = [];

  for (const [mx, my, mz] of legalMoves) {
    // Collect the opponent stones this move would flip
    const flippedStones = [];

    for (const [dx, dy, dz] of directions) {
      const line = [];
      let nx = mx + dx;
      let ny = my + dy;
      let nz = mz + dz;

      while (
        nx >= 0 && nx < size &&
        ny >= 0 && ny < size &&
        nz >= 0 && nz < size &&
        board[nx][ny][nz] === opponent
      ) {
        line.push([nx, ny, nz]);
        nx += dx;
        ny += dy;
        nz += dz;
      }

      // If the line ends at the player's own stone, these stones get flipped
      if (
        line.length > 0 &&
        nx >= 0 && nx < size &&
        ny >= 0 && ny < size &&
        nz >= 0 && nz < size &&
        board[nx][ny][nz] === player
      ) {
        for (const s of line) flippedStones.push(s);
      }
    }

    // Count the empty cells adjacent to the flipped stones, without duplicates
    const emptySet = new Set();
    for (const [fx, fy, fz] of flippedStones) {
      for (const [dx, dy, dz] of directions) {
        const ax = fx + dx;
        const ay = fy + dy;
        const az = fz + dz;
        if (
          ax >= 0 && ax < size &&
          ay >= 0 && ay < size &&
          az >= 0 && az < size &&
          board[ax][ay][az] === null &&
          !(ax === mx && ay === my && az === mz)
        ) {
          emptySet.add(`${ax},${ay},${az}`);
        }
      }
    }

    results.push(`(${mx + 1},${my + 1},${mz + 1}):${emptySet.size}`);
  }

  console.log('[Legal moves - adjacent empty cells] ' + results.join('  '));
}


// ============================================================
// Flipping stones
// ============================================================

/**
 * Applies the flips caused by placing a turnColor stone at (x, y, z),
 * updating both the board data and the 3D display.
 * @param {string} turnColor Color of the player who just moved.
 *   Call this before the turn is switched.
 */
function flipStones(x, y, z, turnColor) {
  const opponent = turnColor === 'black' ? 'white' : 'black';
  let flipped = false;

  for (const [dx, dy, dz] of directions) {
    const stonesToFlip = [];

    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;

    while (
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === opponent
    ) {
      stonesToFlip.push([nx, ny, nz]);
      nx += dx;
      ny += dy;
      nz += dz;
    }

    // If the line is capped by the player's own stone, flip everything in between
    if (
      stonesToFlip.length > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === turnColor
    ) {
      for (const [fx, fy, fz] of stonesToFlip) {
        board[fx][fy][fz] = turnColor;
        removeStoneAt(fx, fy, fz);
        const color = turnColor === 'black' ? 0x000000 : 0xffffff;
        createStone(fx, fy, fz, color);
        flipped = true;
      }
    }
  }

  if (flipped) {
    updateStoneCountDisplay();
  }
}


// ============================================================
// Counting and displaying stones
// ============================================================

/** Counts the black and white stones on the board. */
function countStones() {
  let black = 0;
  let white = 0;
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        if (board[x][y][z] === 'black') black++;
        if (board[x][y][z] === 'white') white++;
      }
    }
  }
  return { black, white };
}

/** Updates the on-screen stone count. */
function updateStoneCountDisplay() {
  const count = countStones();
  const display = document.getElementById('stone-count-display');
  if (display) {
    display.textContent = `BLACK: ${count.black} / WHITE: ${count.white}`;
  }
}


// ============================================================
// Handling passes
// ============================================================

/**
 * Shows the pass notification popup.
 * #pass-popup is styled in CSS with `display: none !important`, so it is
 * shown by toggling the 'visible' class rather than setting style.display.
 */
function showPassPopup() {
  if (gameStarted !== 2) return;
  isPassPopupVisible = true;

  document.getElementById('pass-popup').classList.add('visible');

  // Disable the normal Undo button while the popup is open
  const undoBtn = document.getElementById('undo-button');
  if (undoBtn) undoBtn.disabled = true;
}

/** Hides the pass notification popup. */
function hidePassPopup() {
  document.getElementById('pass-popup').classList.remove('visible');
  isPassPopupVisible = false;

  const undoBtn = document.getElementById('undo-button');
  if (undoBtn) undoBtn.disabled = false;
}

// Confirm the pass (OK button)
document.getElementById('pass-ok-button').addEventListener('click', () => {
  hidePassPopup();

  // Record the pass in the history and switch turns
  moveHistory.push({ player: currentTurn, pass: true });
  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  showAllLegalMoves();

  // If neither player has a legal move, the game is over
  const otherPlayer = currentTurn === 'black' ? 'white' : 'black';
  if (!hasAnyLegalMove(currentTurn) && !hasAnyLegalMove(otherPlayer)) {
    checkGameEnd();
  }
});


// ============================================================
// Game end and sending the game record
// ============================================================

/** Determines the winner at the end of the game and shows the result UI. */
function checkGameEnd() {
  if (gameStarted !== 2) return;

  const result = countStones();
  const winner = result.black > result.white ? 'black' :
    result.white > result.black ? 'white' : 'draw';

  // Convert the history to the stored format (coordinates are 1-based)
  const formattedMoves = moveHistory.map((entry, i) => {
    if (entry.pass) {
      return { turn: i + 1, player: entry.player, pass: true };
    }
    const [x, y, z] = entry.move;
    return { turn: i + 1, player: entry.player, x: x + 1, y: y + 1, z: z + 1 };
  });

  const gameData = {
    first: firstPlayer,
    result: winner,
    score: result,
    moves: formattedMoves
  };

  showGameResultUI(gameData);
}

/** Shows the result and a button to send the game record. */
function showGameResultUI(result) {
  const container = document.createElement('div');
  container.id = 'game-result-ui';
  applyPopupStyle(container);

  const text = document.createElement('p');
  text.textContent = `Winner: ${result.result} (BLACK: ${result.score.black} - WHITE: ${result.score.white})`;
  container.appendChild(text);

  const sendBtn = document.createElement('button');
  sendBtn.textContent = 'Send Game Record';
  sendBtn.style.margin = '10px';

  // Save the record under a new key in Firebase's "kifu" node
  sendBtn.addEventListener('click', () => {
    const kifuRef = ref(database, "kifu");
    const newRef = push(kifuRef);
    set(newRef, result)
      .then(() => {
        alert('Game record sent!');
        container.remove();
        showNewGameButton();
      })
      .catch((error) => {
        console.error("Send error:", error);
        alert("Failed to send the game record.");
      });
  });

  container.appendChild(sendBtn);
  document.body.appendChild(container);
}

/** Shows the "New Game" button (reloads the page when clicked). */
function showNewGameButton() {
  const newGameContainer = document.createElement('div');
  newGameContainer.id = 'new-game-ui';
  applyPopupStyle(newGameContainer);

  const restartBtn = document.createElement('button');
  restartBtn.textContent = 'New Game';
  restartBtn.addEventListener('click', () => {
    location.reload();
  });

  newGameContainer.appendChild(restartBtn);
  document.body.appendChild(newGameContainer);
}

/** Applies the white popup style, positioned in the upper middle of the screen. */
function applyPopupStyle(element) {
  element.style.position = 'absolute';
  element.style.top = '30%';
  element.style.left = '50%';
  element.style.transform = 'translate(-50%, -50%)';
  element.style.backgroundColor = 'white';
  element.style.padding = '20px';
  element.style.borderRadius = '10px';
  element.style.textAlign = 'center';
  element.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
  element.style.zIndex = '100';
}


// ============================================================
// Undo
//
// Approach: remove the last entry from the move history, then replay the
// history from the initial position to rebuild the board. This avoids
// keeping a separate record of flips and keeps the state consistent.
// ============================================================

/** Returns a board containing only the 8 initial stones (4 black, 4 white). */
function buildInitialBoard() {
  const b = [];
  for (let x = 0; x < size; x++) {
    b[x] = [];
    for (let y = 0; y < size; y++) {
      b[x][y] = new Array(size).fill(null);
    }
  }
  b[1][1][1] = 'black';
  b[2][2][1] = 'black';
  b[2][1][2] = 'black';
  b[1][2][2] = 'black';
  b[1][2][1] = 'white';
  b[2][2][2] = 'white';
  b[1][1][2] = 'white';
  b[2][1][1] = 'white';
  return b;
}

/** Applies a move and its flips to board data `b` (the 3D display is not updated). */
function simulateMoveOnBoard(b, x, y, z, player) {
  b[x][y][z] = player;
  const opponent = player === 'black' ? 'white' : 'black';

  for (const [dx, dy, dz] of directions) {
    const stonesToFlip = [];
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;

    while (
      nx >= 0 && nx < size &&
      ny >= 0 && ny < size &&
      nz >= 0 && nz < size &&
      b[nx][ny][nz] === opponent
    ) {
      stonesToFlip.push([nx, ny, nz]);
      nx += dx;
      ny += dy;
      nz += dz;
    }

    if (
      stonesToFlip.length > 0 &&
      nx >= 0 && nx < size &&
      ny >= 0 && ny < size &&
      nz >= 0 && nz < size &&
      b[nx][ny][nz] === player
    ) {
      for (const [fx, fy, fz] of stonesToFlip) {
        b[fx][fy][fz] = player;
      }
    }
  }
}

/** Removes every stone mesh from the scene and empties stoneMap. */
function removeAllStones() {
  const toRemove = [];
  scene.traverse(obj => {
    if (obj instanceof THREE.Mesh && obj.geometry.type === "SphereGeometry") {
      toRemove.push(obj);
    }
  });
  toRemove.forEach(obj => scene.remove(obj));
  stoneMap.clear();
}

/** Redraws every stone to match the current contents of `board`. */
function redrawAllStones() {
  removeAllStones();
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        const cell = board[x][y][z];
        if (cell !== null) {
          const color = cell === 'black' ? 0x000000 : 0xffffff;
          const isLast = lastPlacedStone &&
            lastPlacedStone[0] === x &&
            lastPlacedStone[1] === y &&
            lastPlacedStone[2] === z;
          createStone(x, y, z, color, isLast);
        }
      }
    }
  }
}

/** Entry point for the Undo button. Runs only during a game and while no pass popup is open. */
function undoLastMove() {
  if (gameStarted !== 2) return;
  if (isPassPopupVisible) return;
  undoCore();
}

/** Core logic for undoing one move. */
function undoCore() {
  if (moveHistory.length === 0) {
    return;
  }

  // Remove the last entry from the history
  moveHistory.pop();

  // Rebuild the board by replaying the history from the initial position
  const rebuiltBoard = buildInitialBoard();
  for (const entry of moveHistory) {
    if (entry.pass) continue;
    const [mx, my, mz] = entry.move;
    simulateMoveOnBoard(rebuiltBoard, mx, my, mz, entry.player);
  }

  // Overwrite the global board with the rebuilt one
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        board[x][y][z] = rebuiltBoard[x][y][z];
      }
    }
  }

  // Rebuild the set of occupied cells from the history
  placedStones.clear();
  for (const entry of moveHistory) {
    if (entry.pass) continue;
    placedStones.add(`${entry.move[0]},${entry.move[1]},${entry.move[2]}`);
  }

  // Point "last move" at the latest remaining move
  const lastMoveEntry = [...moveHistory].reverse().find(e => !e.pass);
  if (lastMoveEntry) {
    lastPlacedStone = lastMoveEntry.move;
    lastPlacedColor = lastMoveEntry.player;
  } else {
    lastPlacedStone = null;
    lastPlacedColor = null;
  }

  // Restore the turn (the first player if no moves remain,
  // otherwise the opponent of whoever moved last)
  if (moveHistory.length === 0) {
    currentTurn = firstPlayer;
  } else {
    const lastEntry = moveHistory[moveHistory.length - 1];
    currentTurn = lastEntry.player === 'black' ? 'white' : 'black';
  }

  // Update the 3D display, stone count, and legal-move markers
  redrawAllStones();
  updateStoneCountDisplay();
  showAllLegalMoves();
}
