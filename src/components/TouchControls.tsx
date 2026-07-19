import { useRef } from 'react';
import { playerInputsRef } from '../hooks/usePlayerInputs';

export function TouchControls() {
  const leftActive = useRef(false);
  const rightActive = useRef(false);
  const boostActive = useRef(false);

  const syncInputs = () => {
    // Touch buttons steer by relative rotation: hold to keep turning.
    playerInputsRef.current.turn = (leftActive.current ? 1 : 0) - (rightActive.current ? 1 : 0);
    playerInputsRef.current.boost = boostActive.current;
  };

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-30 flex justify-between p-4 md:hidden">
      <div className="flex gap-3">
        <button
          type="button"
          className="h-16 w-16 rounded-2xl border border-white/20 bg-white/10 text-xl font-bold text-white backdrop-blur active:bg-white/25"
          onPointerDown={(e) => {
            e.preventDefault();
            leftActive.current = true;
            syncInputs();
          }}
          onPointerUp={() => {
            leftActive.current = false;
            syncInputs();
          }}
          onPointerCancel={() => {
            leftActive.current = false;
            syncInputs();
          }}
        >
          ◀
        </button>
        <button
          type="button"
          className="h-16 w-16 rounded-2xl border border-white/20 bg-white/10 text-xl font-bold text-white backdrop-blur active:bg-white/25"
          onPointerDown={(e) => {
            e.preventDefault();
            rightActive.current = true;
            syncInputs();
          }}
          onPointerUp={() => {
            rightActive.current = false;
            syncInputs();
          }}
          onPointerCancel={() => {
            rightActive.current = false;
            syncInputs();
          }}
        >
          ▶
        </button>
      </div>
      <button
        type="button"
        className="h-16 w-24 rounded-2xl border border-fuchsia-400/40 bg-fuchsia-500/20 text-sm font-bold uppercase tracking-wider text-fuchsia-200 backdrop-blur active:bg-fuchsia-500/35"
        onPointerDown={(e) => {
          e.preventDefault();
          boostActive.current = true;
          syncInputs();
        }}
        onPointerUp={() => {
          boostActive.current = false;
          syncInputs();
        }}
        onPointerCancel={() => {
          boostActive.current = false;
          syncInputs();
        }}
      >
        Boost
      </button>
    </div>
  );
}