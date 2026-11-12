/* Reusable edge-to-edge campus traversal. */
window.CampusRoute = class CampusRoute {
  constructor(areas, start = 0, x = 50) { this.areas = areas; this.area = start; this.x = x; }
  move(direction, amount = 4) {
    const previous = this.area;
    this.x += direction * amount;
    if (this.x > 95) {
      if (this.area < this.areas.length - 1) { this.area++; this.x = 6; }
      else this.x = 95;
    } else if (this.x < 5) {
      if (this.area > 0) { this.area--; this.x = 94; }
      else this.x = 5;
    }
    return { area: this.area, x: this.x, changed: previous !== this.area, place: this.areas[this.area] };
  }
};
