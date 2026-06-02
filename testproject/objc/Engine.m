#import <Foundation/Foundation.h>

@protocol Store @end
@interface Base : NSObject @end
@implementation Base @end
@interface Settings : NSObject @end
@implementation Settings @end
@interface Request : NSObject @end
@implementation Request @end

@interface Engine : Base <Store>
@property Settings *settings;
- (Settings *)run:(Request *)req;
@end

@implementation Engine
- (Settings *)run:(Request *)req {
  NSString *s = [NSString stringWithContentsOfFile:@"config/app.json" encoding:0 error:nil];
  return nil;
}
@end
