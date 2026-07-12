// main.js
import * as THREE from './libs/three.module.js';
import { OrbitControls } from './libs/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './libs/CSS2DRenderer.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getDatabase, ref, push, set } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-database.js";

window.init = init;


let scene, camera, renderer, labelRenderer, controls;
let boardGroup;
let currentTurn = 'black'; // current turn ('black' or 'white')
let gameStarted = 0;
let board = [];
const stoneRadius = 0.3;
let lastPlacedStone = null;
const stoneMap = new Map(); // key = "x,y,z", value = stone Mesh
const moveHistory = []; // record of each move
let firstPlayer = 'black';
let lastPlacedColor = null;

// ========================================
// Pass popup visibility flag
// ========================================
let isPassPopupVisible = false;

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

const spacing = 1.2;
const size = 4;

// ========================================
// BUG FIX: declare placedStones in the global scope
// (moved outside showAllLegalMoves so it isn't reset on every call)
// ========================================
const placedStones = new Set();

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

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#ccffd0'); // light green background

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

  labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = 'absolute';
  labelRenderer.domElement.style.top = '0';
  document.body.appendChild(labelRenderer.domElement);

  controls = new OrbitControls(camera, labelRenderer.domElement);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.target.set(3, 3, 3);

  // lights
  const ambientLight = new THREE.AmbientLight(0xffffff, 5);
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 10, 10);
  scene.add(directionalLight);

  const axesHelper = new THREE.AxesHelper(10);
  scene.add(axesHelper);

  for (let x = 0; x < size; x++) {
    board[x] = [];
    for (let y = 0; y < size; y++) {
      board[x][y] = [];
      for (let z = 0; z < size; z++) {
        board[x][y][z] = null;
      }
    }
  }

  // build the board
  boardGroup = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);

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
        const cube = new THREE.Mesh(geometry, transparentMaterial);
        const wireframe = new THREE.Mesh(geometry, wireframeMaterial);

        const boxGroup = new THREE.Group();
        boxGroup.add(cube);
        boxGroup.add(wireframe);

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

  // initial placement (black = 0x000000, white = 0xffffff)
  createStone(1, 1, 1, 0x000000);
  board[1][1][1] = 'black';
  createStone(2, 2, 1, 0x000000);
  board[2][2][1] = 'black';
  createStone(2, 1, 2, 0x000000);
  board[2][1][2] = 'black';
  createStone(1, 2, 2, 0x000000);
  board[1][2][2] = 'black';

  createStone(1, 2, 1, 0xffffff);
  board[1][2][1] = 'white';
  createStone(2, 2, 2, 0xffffff);
  board[2][2][2] = 'white';
  createStone(1, 1, 2, 0xffffff);
  board[1][1][2] = 'white';
  createStone(2, 1, 1, 0xffffff);
  board[2][1][1] = 'white';

  // axis length
  const axisLength = 5;

  const xAxisMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
  const xAxisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(axisLength, 0, 0)
  ]);
  const xAxis = new THREE.Line(xAxisGeometry, xAxisMaterial);
  scene.add(xAxis);

  const yAxisMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00 });
  const yAxisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, axisLength, 0)
  ]);
  const yAxis = new THREE.Line(yAxisGeometry, yAxisMaterial);
  scene.add(yAxis);

  const zAxisMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
  const zAxisGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, axisLength)
  ]);
  const zAxis = new THREE.Line(zAxisGeometry, zAxisMaterial);
  scene.add(zAxis);

  // axis labels
  createAxisLabel('X', (4 + 0.5) * spacing, 0, 0);
  createAxisLabel('Y', 0, (4 + 0.5) * spacing, 0);
  createAxisLabel('Z', 0, 0, (4 + 0.5) * spacing);

  updateStoneCountDisplay();
  animate();

  // ========================================
  // Undo button event registration
  // ========================================
  const undoButton = document.getElementById('undo-button');
  if (undoButton) {
    undoButton.addEventListener('click', () => {
      undoLastMove();
    });
  }

  // "Undo" button inside the pass popup
  const passUndoButton = document.getElementById('pass-undo-button');
  if (passUndoButton) {
    passUndoButton.addEventListener('click', () => {
      hidePassPopup();
      undoCore();
    });
  }
}

function createAxisLabel(text, x, y, z) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // fully transparent background
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // black text only
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

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// turn selection screen
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

  const key = `${x},${y},${z}`;
  stoneMap.set(key, stone);
}

function revertPreviousRedStone(color) {
  if (!lastPlacedStone) return;

  const [x, y, z] = lastPlacedStone;
  const key = `${x},${y},${z}`;
  const mesh = stoneMap.get(key);
  if (mesh) {
    mesh.material.color.set(color);
  }
}

window.addEventListener('pointerdown', (event) => {
  if (gameStarted !== 2) return;
  // ========================================
  // BUG FIX: disable clicks while the pass popup is visible
  // ========================================
  if (isPassPopupVisible) return;

  const mouse = new THREE.Vector2();
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(boardGroup.children, true);
  if (intersects.length > 0) {
    const intersect = intersects[0];
    const point = intersect.object.parent.position;

    const x = Math.round(point.x / spacing) - 1;
    const y = Math.round(point.y / spacing) - 1;
    const z = Math.round(point.z / spacing) - 1;

    const key = `${x},${y},${z}`;
    if (placedStones.has(key)) return;
    if (!isLegalMove(board, x, y, z, currentTurn)) return;

    // revert the previously highlighted stone to its normal color first
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

    // ========================================
    // BUG FIX: pass turnColor into flipStones (called before the turn switches)
    // ========================================
    flipStones(x, y, z, currentTurn);
    updateStoneCountDisplay();

    // switch turn
    currentTurn = currentTurn === 'black' ? 'white' : 'black';
    showAllLegalMoves();

    // pass if the next player has no legal move
    if (gameStarted === 2) {
      if (!hasAnyLegalMove(currentTurn)) {
        const otherPlayer = currentTurn === 'black' ? 'white' : 'black';
        if (!hasAnyLegalMove(otherPlayer)) {
          checkGameEnd();
        } else {
          showPassPopup();
        }
      }
    }
  }
});


function clearLegalMoveMarkers() {
  const toRemove = [];
  scene.traverse(obj => {
    if (obj.userData && obj.userData.isLegalMoveMarker) {
      toRemove.push(obj);
    }
  });
  toRemove.forEach(obj => scene.remove(obj));
}


function showAllLegalMoves() {
  clearLegalMoveMarkers();

  const legalMovesList = [];

  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      for (let z = 0; z < 4; z++) {
        const legal = isLegalMove(board, x, y, z, currentTurn);
        if (legal) {
          showLegalMoveIndicator(x, y, z);
          legalMovesList.push([x, y, z]);
        }
      }
    }
  }

  // ========================================
  // Dev tool: log the number of empty cells adjacent to the stones
  // that would be flipped by each legal move
  // ========================================
  logLegalMovesInfo(legalMovesList, currentTurn);
}

/**
 * For each legal move, logs to the console the total number of empty
 * cells (26-neighborhood) adjacent to the opponent stones that would
 * be flipped by that move.
 *
 * The cell being played is never counted as empty.
 *
 * Output format: "(x,y,z):N" for each legal move
 */
function logLegalMovesInfo(legalMoves, player) {
  if (legalMoves.length === 0) return;

  const opponent = player === 'black' ? 'white' : 'black';
  const results = [];

  for (const [mx, my, mz] of legalMoves) {
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
    const emptyCount = emptySet.size;

    results.push(`(${mx+1},${my+1},${mz+1}):${emptyCount}`);
  }

  console.log('[Legal moves - adjacent empty cells] ' + results.join('  '));
}

function isLegalMove(board, x, y, z, currentTurn) {
  if (board[x][y][z] !== null) {
    return false;
  }

  const opponent = currentTurn === 'black' ? 'white' : 'black';
  let legal = false;

  for (const [dx, dy, dz] of directions) {
    let nx = x + dx;
    let ny = y + dy;
    let nz = z + dz;
    let count = 0;

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

    if (
      count > 0 &&
      nx >= 0 && nx < 4 &&
      ny >= 0 && ny < 4 &&
      nz >= 0 && nz < 4 &&
      board[nx][ny][nz] === currentTurn
    ) {
      legal = true;
      break;
    }
  }

  return legal;
}

function showLegalMoveIndicator(x, y, z) {
  const geometry = new THREE.SphereGeometry(stoneRadius * 0.6, 16, 16);
  const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
  const sphere = new THREE.Mesh(geometry, material);

  sphere.userData.isLegalMoveMarker = true;

  sphere.position.set(
    (x + 1.0) * spacing,
    (y + 1.0) * spacing,
    (z + 1.0) * spacing
  );

  sphere.name = 'legalMoveIndicator';
  scene.add(sphere);
}

// ========================================
// BUG FIX: added a turnColor argument to flipStones.
// The old code referenced the global currentTurn with no argument,
// so calling it after the turn had already switched flipped the wrong color.
// ========================================
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

function placeStone(x, y, z) {
  const color = currentTurn === 'black' ? 0x000000 : 0xffffff;

  createStone(x, y, z, color);
  board[x][y][z] = currentTurn;

  flipStones(x, y, z, currentTurn);

  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  showAllLegalMoves();
}

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

function showGameResultUI(result) {
  const container = document.createElement('div');
  container.id = 'game-result-ui';
  container.style.position = 'absolute';
  container.style.top = '30%';
  container.style.left = '50%';
  container.style.transform = 'translate(-50%, -50%)';
  container.style.backgroundColor = 'white';
  container.style.padding = '20px';
  container.style.borderRadius = '10px';
  container.style.textAlign = 'center';
  container.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
  container.style.zIndex = '100';

  const text = document.createElement('p');
  text.textContent = `Winner: ${result.result} (BLACK: ${result.score.black} - WHITE: ${result.score.white})`;
  container.appendChild(text);

  const sendBtn = document.createElement('button');
  sendBtn.textContent = 'Send Game Record';
  sendBtn.style.margin = '10px';

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

function showNewGameButton() {
  const newGameContainer = document.createElement('div');
  newGameContainer.id = 'new-game-ui';
  newGameContainer.style.position = 'absolute';
  newGameContainer.style.top = '30%';
  newGameContainer.style.left = '50%';
  newGameContainer.style.transform = 'translate(-50%, -50%)';
  newGameContainer.style.backgroundColor = 'white';
  newGameContainer.style.padding = '20px';
  newGameContainer.style.borderRadius = '10px';
  newGameContainer.style.textAlign = 'center';
  newGameContainer.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
  newGameContainer.style.zIndex = '100';

  const restartBtn = document.createElement('button');
  restartBtn.textContent = 'New Game';
  restartBtn.addEventListener('click', () => {
    location.reload();
  });

  newGameContainer.appendChild(restartBtn);
  document.body.appendChild(newGameContainer);
}


function checkGameEnd() {
  if (gameStarted !== 2) return;

  const result = countStones();
  let winner = result.black > result.white ? 'black' :
    result.white > result.black ? 'white' : 'draw';

  const formattedMoves = moveHistory.map((entry, i) => {
    if (entry.pass) {
      return { turn: i + 1, player: entry.player, pass: true };
    } else {
      const [x, y, z] = entry.move;
      return { turn: i + 1, player: entry.player, x: x + 1, y: y + 1, z: z + 1 };
    }
  });

  const gameData = {
    first: firstPlayer,
    result: winner,
    score: result,
    moves: formattedMoves
  };

  showGameResultUI(gameData);
}

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

function showPassPopup() {
  if (gameStarted !== 2) return;
  isPassPopupVisible = true;

  // ========================================
  // BUG FIX: #pass-popup is defined in CSS as
  //   display: none !important
  //   #pass-popup.visible { display: flex !important }
  // so setting style.display = 'block' loses to !important
  // and never actually shows. Use classList.add('visible') instead.
  // ========================================
  document.getElementById('pass-popup').classList.add('visible');

  const undoBtn = document.getElementById('undo-button');
  if (undoBtn) undoBtn.disabled = true;
}

function hidePassPopup() {
  document.getElementById('pass-popup').classList.remove('visible');
  isPassPopupVisible = false;

  const undoBtn = document.getElementById('undo-button');
  if (undoBtn) undoBtn.disabled = false;
}

document.getElementById('pass-ok-button').addEventListener('click', () => {
  hidePassPopup();

  moveHistory.push({ player: currentTurn, pass: true });

  currentTurn = currentTurn === 'black' ? 'white' : 'black';
  showAllLegalMoves();

  if (!hasAnyLegalMove(currentTurn) && !hasAnyLegalMove(currentTurn === 'black' ? 'white' : 'black')) {
    checkGameEnd();
  }
});


function updateStoneCountDisplay() {
  const count = countStones();
  const display = document.getElementById('stone-count-display');
  if (display) {
    display.textContent = `BLACK: ${count.black} / WHITE: ${count.white}`;
  }
}


// ========================================
// Undo feature (for human vs human games)
// ========================================

/**
 * Returns a fresh board with the initial 8 stones placed.
 */
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

/**
 * Applies the flips that result from `player` placing a stone at
 * (x, y, z) on board `b`.
 */
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

/**
 * Removes every stone mesh from the scene and clears stoneMap.
 */
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

/**
 * Redraws every stone according to the current `board` array.
 */
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

/**
 * Entry point called from the external "#undo-button".
 */
function undoLastMove() {
  if (gameStarted !== 2) return;
  if (isPassPopupVisible) return;
  undoCore();
}

/**
 * Core logic for undoing one move.
 */
function undoCore() {
  if (moveHistory.length === 0) {
    return;
  }

  moveHistory.pop();

  const rebuiltBoard = buildInitialBoard();
  for (const entry of moveHistory) {
    if (entry.pass) continue;
    const [mx, my, mz] = entry.move;
    simulateMoveOnBoard(rebuiltBoard, mx, my, mz, entry.player);
  }

  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        board[x][y][z] = rebuiltBoard[x][y][z];
      }
    }
  }

  placedStones.clear();
  for (const entry of moveHistory) {
    if (entry.pass) continue;
    placedStones.add(`${entry.move[0]},${entry.move[1]},${entry.move[2]}`);
  }

  const lastMoveEntry = [...moveHistory].reverse().find(e => !e.pass);
  if (lastMoveEntry) {
    lastPlacedStone = lastMoveEntry.move;
    lastPlacedColor = lastMoveEntry.player;
  } else {
    lastPlacedStone = null;
    lastPlacedColor = null;
  }

  if (moveHistory.length === 0) {
    currentTurn = firstPlayer;
  } else {
    const lastEntry = moveHistory[moveHistory.length - 1];
    currentTurn = lastEntry.player === 'black' ? 'white' : 'black';
  }

  redrawAllStones();
  updateStoneCountDisplay();
  showAllLegalMoves();

}
