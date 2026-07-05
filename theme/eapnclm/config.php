<?php
// This file is part of the theme_eapnclm plugin for Moodle.
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Theme configuration for EAPN-CLM (Boost child theme).
 *
 * @package    theme_eapnclm
 * @copyright  2026 EAPN Castilla-La Mancha
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$THEME->name = 'eapnclm';

// Inherit everything from Boost and only override what we need.
$THEME->parents = ['boost'];

// We provide all our styling through SCSS callbacks (no static sheets).
$THEME->sheets = [];
$THEME->editor_sheets = [];

// SCSS pipeline: main preset + pre (variables) + extra (components).
$THEME->scss = function($theme) {
    return theme_eapnclm_get_main_scss_content($theme);
};
$THEME->prescsscallback   = 'theme_eapnclm_get_pre_scss';
$THEME->extrascsscallback = 'theme_eapnclm_get_extra_scss';

// Standard Boost child settings.
$THEME->enable_dock = false;
$THEME->rendererfactory = 'theme_overridden_renderer_factory';
$THEME->requiredblocks = '';
$THEME->addblockposition = BLOCK_ADDBLOCK_POSITION_FLATNAV;
$THEME->iconsystem = \core\output\icon_system::FONTAWESOME;
$THEME->haseditswitch = true;
$THEME->usescourseindex = true;

// Layouts (columns, login, course, etc.) are inherited automatically from Boost.
