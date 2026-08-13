<?php
namespace testproject\php;

interface Store {}
class Base {}
class Settings {}
class Request {}

#[Route]
class Engine extends Base implements Store {
  public Settings $settings;
  
  #[Route]
  public function run(Request $req): Settings {
    require "config/bootstrap.php";
    return new Settings();
  }
}
