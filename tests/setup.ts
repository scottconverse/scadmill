import "@testing-library/jest-dom/vitest";

const emptyRect: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
};

if (typeof Range !== "undefined") {
  Range.prototype.getBoundingClientRect = () => emptyRect;
  Range.prototype.getClientRects = () => {
    const rectangles: DOMRect[] = [];
    return {
      length: 0,
      item: () => null,
      [Symbol.iterator]: () => rectangles[Symbol.iterator](),
    } as DOMRectList;
  };
}
