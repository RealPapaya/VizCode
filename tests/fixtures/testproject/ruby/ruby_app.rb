require_relative "ruby_lib"

class RubyApp
  def run
    lib = RubyLib.new
    lib.ruby_process("hello")
  end
end
