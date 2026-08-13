defmodule ElixirLib do
  @spec elixir_process(String.t()) :: :ok
  def elixir_process(item) do
    IO.puts("Elixir process #{item}")
    File.read("elixir_config.yaml")
    :ok
  end
end
