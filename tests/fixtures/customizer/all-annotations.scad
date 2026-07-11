// Customizer extraction fixture.

/* [Dimensions] */
// Overall width
width = 60; // [20:5:200]
depth = 40; // [20:200]
wall = 2.4;
origin = [0, -2.5, 3, 4];

/* [Style] */
corner = "round"; // [round:Rounded, square:Square]
material = "pla"; // [pla, petg, abs]
enabled = true;
title = "Storage box"; // Display name
fallback = 7; // [0:nope:10]
computed = width / 2;
weights = [1, 2, 3, 4, 5];

/* [Hidden] */
$fn = 48;

module shell() {
    inside = 99;
}

after_geometry = 100;
