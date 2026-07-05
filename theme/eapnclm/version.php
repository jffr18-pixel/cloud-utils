<?php
// This file is part of the theme_eapnclm plugin for Moodle.
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Version details for the EAPN-CLM theme (Gestión Social CLM · Aula Virtual).
 *
 * @package    theme_eapnclm
 * @copyright  2026 EAPN Castilla-La Mancha
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$plugin->component = 'theme_eapnclm';
$plugin->version   = 2026070500;
$plugin->requires  = 2022112800;              // Moodle 4.1 (LTS) or later.
$plugin->maturity  = MATURITY_STABLE;
$plugin->release   = '1.0.0';
$plugin->dependencies = [
    'theme_boost' => 2022112800,
];
