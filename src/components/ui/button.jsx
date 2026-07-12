export function Button({ className = "", variant = "default", children, ...props }) {
  const variants = {
    default: "bg-cyan-500 hover:bg-cyan-400 text-white",
    outline: "border border-white/20 bg-white/5 hover:bg-white/10 text-white",
  };
  return (
    <button
      className={`inline-flex items-center justify-center font-semibold transition-colors focus:outline-none ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
