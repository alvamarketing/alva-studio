<?php

require_once dirname(__DIR__) . '/bootstrap.php';

while (true) {
    AlvaOutbox::processOne();
    usleep(500000);
}
