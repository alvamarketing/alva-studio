<?php
require_once dirname(__DIR__) . '/bootstrap.php';
AlvaOutbox::processOne();
