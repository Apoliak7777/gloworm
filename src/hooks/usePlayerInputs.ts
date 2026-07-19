import { useEffect } from 'react';
import { InputState } from '../shared/gameLogic';

const EMPTY_INPUTS: InputState = { targetAngle: null, turn: 0, boost: false };

export const playerInputsRef = { current: { ...EMPTY_INPUTS } };

/**
 * Steering model: HOLD TO ROTATE.
 *
 * Holding A / ArrowLeft spins the snake anticlockwise for as long as it is
 * held; D / ArrowRight spins it clockwise. The rotation itself is eased by
 * stepLocalPlayer's angular-velocity model, so a held turn accelerates into the
 * arc and coasts out of it instead of snapping on and off.
 *
 * The mouse offers an alternative absolute-aim scheme, but it never takes over
 * while a turn key is held, so a keyboard player can't be hijacked mid-turn.
 */
const held = { left: false, right: false, boost: false };

export const pointerSteering = { active: false, x: 0, y: 0 };
export let inputMode: 'keyboard' | 'pointer' = 'keyboard';

/** Deliberate mouse movement needed before the pointer takes over steering. */
const POINTER_TAKEOVER_PX = 12;
let lastPointerX = 0;
let lastPointerY = 0;

/**
 * Cursor distance from screen centre below which we hold the current heading.
 * The snake sits at the centre, so a cursor on top of it gives a tiny, noisy
 * direction vector — without this the snake spirals on the spot.
 */
export const POINTER_DEAD_ZONE_PX = 60;

function applyTurn() {
  // Left is anticlockwise (+), right is clockwise (-); holding both cancels out.
  playerInputsRef.current.turn = (held.left ? 1 : 0) - (held.right ? 1 : 0);
}

export function resetPlayerInputs() {
  held.left = held.right = held.boost = false;
  pointerSteering.active = false;
  inputMode = 'keyboard';
  playerInputsRef.current = { ...EMPTY_INPUTS };
}

const PREVENT_DEFAULT_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '];

export function usePlayerInputs() {
  useEffect(() => {
    /** Returns true if the key is a steering key (as opposed to boost/unknown). */
    const applyKey = (key: string, pressed: boolean): 'turn' | 'boost' | null => {
      const k = key.length === 1 ? key.toLowerCase() : key;
      switch (k) {
        case 'a':
        case 'ArrowLeft':
          held.left = pressed;
          applyTurn();
          return 'turn';
        case 'd':
        case 'ArrowRight':
          held.right = pressed;
          applyTurn();
          return 'turn';
        case 'w':
        case 'ArrowUp':
        case ' ':
        case 'Shift':
          held.boost = pressed;
          playerInputsRef.current.boost = pressed;
          return 'boost';
        default:
          return null;
      }
    };

    // Don't hijack keys while the user is typing in a field.
    const isEditableTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isEditableTarget(e.target)) return;
      const kind = applyKey(e.key, true);
      if (kind === 'turn') {
        // Steering with the keyboard: stop honouring the cursor.
        inputMode = 'keyboard';
        playerInputsRef.current.targetAngle = null;
      }
      if (kind && PREVENT_DEFAULT_KEYS.includes(e.key)) e.preventDefault();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      applyKey(e.key, false);
    };

    const onBlur = () => resetPlayerInputs();

    const onPointerMove = (e: PointerEvent) => {
      // Mobile steers with the on-screen buttons, not a synthetic pointer.
      if (e.pointerType === 'touch') return;
      // Never steal control from a hand that is actively turning.
      if (held.left || held.right) return;

      pointerSteering.x = e.clientX;
      pointerSteering.y = e.clientY;

      // Only hand over after a deliberate movement, so a stray nudge (or the
      // cursor left sitting on the Play button) can't hijack steering.
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      if (dx * dx + dy * dy < POINTER_TAKEOVER_PX * POINTER_TAKEOVER_PX) return;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;

      if (inputMode !== 'pointer') {
        inputMode = 'pointer';
        playerInputsRef.current.turn = 0;
      }
      pointerSteering.active = true;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      if (isEditableTarget(e.target)) return;
      playerInputsRef.current.boost = true;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      // Don't cut a boost the keyboard is still holding.
      if (!held.boost) playerInputsRef.current.boost = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  return playerInputsRef;
}
