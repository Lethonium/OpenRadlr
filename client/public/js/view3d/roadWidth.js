/** How wide a road is drawn: lanes, shoulder and verge, in metres. */
export const LANE_WIDTH = 1.4;
export const SHOULDER = 0.9;
export const VERGE = 1.1;

export const roadHalfWidth = (lanes) => (lanes * LANE_WIDTH) / 2 + SHOULDER;
