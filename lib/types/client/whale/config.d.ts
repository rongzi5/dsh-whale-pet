/**
 * Shared constants for the procedural killer-whale scene.
 *
 * These values are ported verbatim from the original demo runtime; keep them
 * in one place so geometry, materials and animation can refer to the same
 * tuning numbers without circular imports.
 */
export declare const CFG: {
    readonly SWEPT_SLICES: 60;
    readonly SWEPT_RINGS: 48;
    readonly BODY_TARGET_HEIGHT: 3.5;
    readonly TAIL_FORK_SCALE: 0.177;
    readonly TAIL_THICKNESS: 0.06;
    readonly TAIL_OPEN_ANGLE_DEG: 76.95;
    readonly TAIL_NOTCH_DX: 0.3;
    readonly TAIL_NOTCH_DY: 0.5;
    readonly TAIL_TILT_DEG: 50;
    readonly DORSAL_START_FRAC: 0.331;
    readonly DORSAL_END_FRAC: 0.559;
    readonly DORSAL_SAMPLES: 40;
    readonly DORSAL_THICKNESS: 0.06;
    readonly DORSAL_HEIGHT_SCALE: 0.3186;
    readonly DORSAL_SINK: 0;
    readonly PEC_START_FRAC: 0.38;
    readonly PEC_END_FRAC: 0.48;
    readonly PEC_SPAN: 0.924;
    readonly PEC_SWEEP: 0.33;
    readonly PEC_THICKNESS: 0.05;
    readonly PEC_ANGLE_DEG: 30;
    readonly PEC_RADIAN: 130;
    readonly PEC_SINK: 0;
    readonly PEC_OUTWARD_OFFSET: -0.025;
    readonly PEC_BACKWARD_OFFSET: 0;
    readonly BROW_SCALE: 0.65;
    readonly BROW_OFFSET_X: -35.4;
    readonly BROW_OFFSET_Y: 6;
    readonly BROW_LIFT: 0.9;
    readonly EYE_OFFSET_Y: 10.5;
    readonly EYE_RADIUS: 2.8;
    readonly EYE_CIRCLE_SEGMENTS: 32;
    readonly COLOR_BODY_BLUE: 5073918;
    readonly COLOR_WHITE: 16777215;
    readonly SWIM_SPEED: 0.9;
    readonly BODY_SWAY_AMPLITUDE: 0.04;
    readonly TAIL_SWAY_AMPLITUDE: 0.08;
    readonly TAIL_PITCH_AMPLITUDE: 0.15;
    readonly PEC_FLAP_AMPLITUDE: 0.25;
    readonly PEC_FLAP_PHASE: 0.6;
    readonly PITCH_AMPLITUDE: 0.015;
    readonly ROLL_AMPLITUDE: 0.01;
    readonly BLINK_INTERVAL: 3.4;
    readonly BLINK_DURATION: 0.2;
    readonly FLOAT_AMPLITUDE: 0.06;
    readonly FLOAT_SPEED: 1.2;
    readonly HOVER_SWIM_BOOST: 1.2;
};
export declare const PATH = "M 144.00 80.00 C 144.67 84.83, 143.00 95.34, 141.00 102.00 C 139.00 108.66, 136.50 113.84, 132.00 120.00 C 127.50 126.16, 119.66 134.34, 114.00 139.00 C 108.34 143.66, 103.49 146.17, 98.00 148.00 C 92.51 149.83, 87.83 150.83, 81.00 150.00 C 74.17 149.17, 63.83 146.66, 57.00 143.00 C 50.17 139.34, 44.50 134.16, 40.00 128.00 C 35.50 121.84, 31.83 113.16, 30.00 106.00 C 28.17 98.84, 28.17 90.99, 29.00 85.00 C 29.83 79.01, 32.17 74.50, 35.00 70.00 C 37.83 65.50, 41.67 61.00, 46.00 58.00 C 50.33 55.00, 56.01 53.00, 61.00 52.00 C 66.00 51.00, 70.51 51.00, 76.00 52.00 C 81.49 53.00, 85.34 52.34, 94.00 58.00 C 102.66 63.66, 120.84 83.50, 128.00 86.00 C 135.16 88.50, 134.34 74.00, 137.00 73.00 C 139.66 72.00, 143.33 75.17, 144.00 80.00 Z";
export declare const BROW_PATH = "M 146.00 127.00 C 144.34 128.00, 138.50 129.50, 136.00 129.00 C 133.50 128.50, 131.83 126.33, 131.00 124.00 C 130.17 121.67, 131.67 117.16, 131.00 115.00 C 130.33 112.84, 128.33 111.67, 127.00 111.00 C 125.67 110.33, 124.00 111.33, 123.00 111.00 C 122.00 110.67, 121.17 109.83, 121.00 109.00 C 120.83 108.17, 120.50 106.67, 122.00 106.00 C 123.50 105.33, 127.84 104.67, 130.00 105.00 C 132.16 105.33, 133.00 106.17, 135.00 108.00 C 137.00 109.83, 140.17 113.50, 142.00 116.00 C 143.83 118.50, 145.33 121.17, 146.00 123.00 C 146.67 124.83, 147.66 126.00, 146.00 127.00 Z";
export declare const TAIL_PATH = "M 17.902 4.103 L 22.379 9.998 C 22.435 9.614, 22.507 9.073, 22.499 8.762 C 22.494 8.572, 22.538 8.499, 22.755 8.477 C 23.354 8.408, 23.935 8.244, 24.469 7.950 C 26.019 7.104, 26.644 5.713, 26.791 4.047 C 26.813 3.792, 26.787 3.529, 26.517 3.395 C 26.235 3.257, 26.114 3.520, 25.949 3.653 C 25.892 3.697, 25.845 3.753, 25.797 3.805 C 25.385 4.245, 24.903 4.534, 24.274 4.500 C 23.354 4.448, 22.568 4.737, 21.873 5.441 C 21.726 4.573, 21.235 4.055, 20.489 3.723 C 20.099 3.551, 19.703 3.377, 19.430 3.002 C 19.239 2.735, 19.186 2.437, 19.091 2.143 C 19.030 1.966, 18.970 1.785, 18.766 1.754 C 18.544 1.720, 18.457 1.905, 18.370 2.061 C 18.023 2.695, 17.889 3.395, 17.902 4.103 Z";
export declare const DORSAL_PATH = "M 10.436 2.993 L 13.852 4.746 C 12.758 3.684, 13.995 2.812, 14.282 2.708 C 14.581 2.600, 14.386 2.229, 13.418 2.233 C 12.450 2.237, 11.565 2.562, 10.436 2.993 Z";
export declare const PEC_PATH = "M 16.747 19.267 L 20.614 19.565 C 20.093 19.673, 19.421 19.772, 18.722 19.707 C 17.815 19.630, 17.268 19.526, 16.747 19.267 Z";
export declare const TAIL_NOTCH: {
    x: number;
    y: number;
};
export declare const DORSAL_BL = 10.436;
export declare const DORSAL_BR = 13.852;
export declare const PEC_BL = 16.747;
export declare const PEC_BR = 20.614;
export declare const PEC_DROP = 0.288;
