import 'dart:io';

class Base {}
mixin Store {}
class Settings {}
class Request {}

@Deprecated('demo')
class Engine extends Base with Store {
  Settings settings = Settings();
  
  @override
  Settings run(Request req) {
    final cfg = File('config/app.json');
    return Settings();
  }
}
