<?php
// This file is part of the theme_eapnclm plugin for Moodle.
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Theme functions for EAPN-CLM.
 *
 * @package    theme_eapnclm
 * @copyright  2026 EAPN Castilla-La Mancha
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

/**
 * Returns the main SCSS content: the chosen preset (defaults to Boost's).
 *
 * @param theme_config $theme The theme config object.
 * @return string
 */
function theme_eapnclm_get_main_scss_content($theme) {
    global $CFG;

    $scss = '';
    $filename = !empty($theme->settings->preset) ? $theme->settings->preset : 'default.scss';
    $fs = get_file_storage();

    $context = context_system::instance();
    if ($filename == 'default.scss') {
        $scss .= file_get_contents($CFG->dirroot . '/theme/boost/scss/preset/default.scss');
    } else if ($filename == 'plain.scss') {
        $scss .= file_get_contents($CFG->dirroot . '/theme/boost/scss/preset/plain.scss');
    } else if ($filename && ($presetfile = $fs->get_file($context->id, 'theme_eapnclm', 'preset', 0, '/', $filename))) {
        // A preset file uploaded in the theme settings.
        $scss .= $presetfile->get_content();
    } else {
        // Fallback to Boost's default preset.
        $scss .= file_get_contents($CFG->dirroot . '/theme/boost/scss/preset/default.scss');
    }

    return $scss;
}

/**
 * Injects our SCSS variables *before* the Bootstrap/Boost variables so they can
 * be overridden by admin settings, and before the preset is compiled.
 *
 * @param theme_config $theme The theme config object.
 * @return string
 */
function theme_eapnclm_get_pre_scss($theme) {
    global $CFG;

    $scss = '';
    $configurable = [
        // Setting name => list of SCSS variables to set from it.
        'brandprimary'   => ['primary', 'brand-primary'],
        'brandsecondary' => ['secondary'],
        'brandaccent'    => ['accent'],
    ];

    // Prepend variables first so the theme's own values act as defaults.
    $scss .= file_get_contents($CFG->dirroot . '/theme/eapnclm/scss/pre.scss');

    // Let admins override the brand colours from theme settings.
    foreach ($configurable as $configkey => $targets) {
        $value = isset($theme->settings->{$configkey}) ? $theme->settings->{$configkey} : null;
        if (empty($value)) {
            continue;
        }
        array_map(function($target) use (&$scss, $value) {
            $scss .= '$' . $target . ': ' . $value . ";\n";
        }, (array) $targets);
    }

    // Raw SCSS from the "Raw initial SCSS" admin setting.
    if (!empty($theme->settings->scsspre)) {
        $scss .= $theme->settings->scsspre;
    }

    return $scss;
}

/**
 * Injects our component SCSS *after* everything else so it wins the cascade.
 *
 * @param theme_config $theme The theme config object.
 * @return string
 */
function theme_eapnclm_get_extra_scss($theme) {
    global $CFG;

    $content = file_get_contents($CFG->dirroot . '/theme/eapnclm/scss/post.scss');

    // Raw SCSS from the "Raw SCSS" admin setting.
    if (!empty($theme->settings->scss)) {
        $content .= "\n" . $theme->settings->scss;
    }

    return $content;
}
