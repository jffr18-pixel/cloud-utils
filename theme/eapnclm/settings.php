<?php
// This file is part of the theme_eapnclm plugin for Moodle.
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

/**
 * Admin settings for the EAPN-CLM theme.
 *
 * @package    theme_eapnclm
 * @copyright  2026 EAPN Castilla-La Mancha
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

if ($ADMIN->fulltree) {

    $settings = new theme_boost_admin_settingspage_tabs('themesettingeapnclm', get_string('configtitle', 'theme_eapnclm'));

    // ------------------------------------------------------------------
    // General tab.
    // ------------------------------------------------------------------
    $page = new admin_settingpage('theme_eapnclm_general', get_string('generalsettings', 'theme_eapnclm'));

    // Preset selector.
    $name = 'theme_eapnclm/preset';
    $title = get_string('preset', 'theme_eapnclm');
    $description = get_string('preset_desc', 'theme_eapnclm');
    $default = 'default.scss';

    $context = context_system::instance();
    $fs = get_file_storage();
    $files = $fs->get_area_files($context->id, 'theme_eapnclm', 'preset', 0, 'itemid, filepath, filename', false);
    $choices = [];
    foreach ($files as $file) {
        $choices[$file->get_filename()] = $file->get_filename();
    }
    $choices['default.scss'] = 'default.scss';
    $choices['plain.scss'] = 'plain.scss';

    $setting = new admin_setting_configthemepreset($name, $title, $description, $default, $choices, 'eapnclm');
    $setting->set_updatedcallback('theme_reset_all_caches');
    $page->add($setting);

    // Uploaded preset files.
    $name = 'theme_eapnclm/presetfiles';
    $title = get_string('presetfiles', 'theme_eapnclm');
    $description = get_string('presetfiles_desc', 'theme_eapnclm');
    $setting = new admin_setting_configstoredfile($name, $title, $description, 'preset', 0,
        ['maxfiles' => 20, 'accepted_types' => ['.scss']]);
    $page->add($setting);

    // Brand colours.
    $name = 'theme_eapnclm/brandprimary';
    $title = get_string('brandprimary', 'theme_eapnclm');
    $description = get_string('brandprimary_desc', 'theme_eapnclm');
    $setting = new admin_setting_configcolourpicker($name, $title, $description, '#286782');
    $setting->set_updatedcallback('theme_reset_all_caches');
    $page->add($setting);

    $name = 'theme_eapnclm/brandsecondary';
    $title = get_string('brandsecondary', 'theme_eapnclm');
    $description = get_string('brandsecondary_desc', 'theme_eapnclm');
    $setting = new admin_setting_configcolourpicker($name, $title, $description, '#801d43');
    $setting->set_updatedcallback('theme_reset_all_caches');
    $page->add($setting);

    $name = 'theme_eapnclm/brandaccent';
    $title = get_string('brandaccent', 'theme_eapnclm');
    $description = get_string('brandaccent_desc', 'theme_eapnclm');
    $setting = new admin_setting_configcolourpicker($name, $title, $description, '#b01e54');
    $setting->set_updatedcallback('theme_reset_all_caches');
    $page->add($setting);

    $settings->add($page);

    // ------------------------------------------------------------------
    // Advanced tab (raw SCSS).
    // ------------------------------------------------------------------
    $page = new admin_settingpage('theme_eapnclm_advanced', get_string('advancedsettings', 'theme_eapnclm'));

    $name = 'theme_eapnclm/scsspre';
    $title = get_string('rawscsspre', 'theme_eapnclm');
    $description = get_string('rawscsspre_desc', 'theme_eapnclm');
    $setting = new admin_setting_scsscode($name, $title, $description, '', PARAM_RAW);
    $setting->set_updatedcallback('theme_reset_all_caches');
    $page->add($setting);

    $name = 'theme_eapnclm/scss';
    $title = get_string('rawscss', 'theme_eapnclm');
    $description = get_string('rawscss_desc', 'theme_eapnclm');
    $setting = new admin_setting_scsscode($name, $title, $description, '', PARAM_RAW);
    $setting->set_updatedcallback('theme_reset_all_caches');
    $page->add($setting);

    $settings->add($page);
}
